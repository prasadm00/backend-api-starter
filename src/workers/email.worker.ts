/**
 * Background worker process (run separately from the API server).
 *
 * Does two jobs:
 *  1. Consumes the "ecommerce-events" BullMQ queue and sends notification emails.
 *  2. Polls the transactional outbox table and publishes pending events to that
 *     queue. It runs here so the API can commit an order or payment without
 *     needing Redis to be reachable at that moment.
 */
import { Worker, type Job } from "bullmq";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { logger } from "../common/logger.js";
import {
  redisQueueConnection,
  bullMqQueueService,
} from "../common/queue/bullmqQueue.service.js";
import { flushOutboxBatch } from "../common/queue/outbox.service.js";

interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
}
/**
 * Sends one email via the configured transport.
 *
 * `idempotencyKey` (the job id) is forwarded as the `idempotency-key` header so
 * a retried job can be recognised by the receiving service if it supports that.
 *
 * @throws {Error} In production with the "log" transport, with missing webhook
 *   settings, or on a non-2xx response. Throwing makes BullMQ retry the job.
 */
async function deliver(payload: EmailPayload): Promise<void> {
  if (env.EMAIL_TRANSPORT === "log") {
    // Explicitly a SIMULATED transport; no message was delivered.
    if (env.NODE_ENV === "production")
      throw new Error("Log email transport cannot deliver production emails");
    logger.info(
      { idempotencyKey: payload.idempotencyKey, subject: payload.subject },
      "SIMULATED EMAIL ONLY - NOT SENT",
    );
    return;
  }
  if (!env.EMAIL_API_URL || !env.EMAIL_API_KEY)
    throw new Error(
      "EMAIL_API_URL and EMAIL_API_KEY are required for webhook transport",
    );
  const response = await fetch(env.EMAIL_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.EMAIL_API_KEY}`,
      "idempotency-key": payload.idempotencyKey,
    },
    body: JSON.stringify({
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
    }),
    // Bound the call so a hung email API can't tie up one of the worker's slots.
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error(`Email transport rejected job: HTTP ${response.status}`);
}

/**
 * Handles one queue job: resolve the recipient, pick a subject by event name, send.
 *
 * Delivery is at-least-once (see `flushOutboxBatch`, and BullMQ retries), so the
 * job id is used as the idempotency key for the send.
 *
 * @throws {Error} When no recipient can be found or the job name is unknown;
 *   BullMQ then records the failure and retries per the attempts set at enqueue.
 */
async function processEmailJob(job: Job): Promise<{ processed: boolean }> {
  const data = job.data as Record<string, unknown>;
  // Recipient lookup order: address in the payload, else via userId, else via the
  // order's user. Event payloads may carry only ids rather than an address.
  let email: string | undefined;
  if (typeof data.email === "string") email = data.email;
  if (!email && typeof data.userId === "string") {
    const user = await prisma.user.findUnique({
      where: { id: data.userId },
      select: { email: true },
    });
    email = user?.email;
  }
  if (!email && typeof data.orderId === "string") {
    const order = await prisma.order.findUnique({
      where: { id: data.orderId },
      select: { user: { select: { email: true } } },
    });
    email = order?.user.email;
  }
  if (!email) throw new Error("Cannot deliver email: recipient missing");
  const subjectMap: Record<string, string> = {
    USER_REGISTERED: "Welcome to the store",
    ORDER_CREATED: "Your order was created",
    PAYMENT_CONFIRMED: "Your payment was confirmed",
  };
  const subject = subjectMap[job.name];
  if (!subject) throw new Error(`Unrecognized notification job ${job.name}`);
  await deliver({
    to: email,
    subject,
    text: `${subject}. Reference: ${String(data.orderId ?? data.userId ?? job.id)}.`,
    idempotencyKey: String(job.id),
  });
  return { processed: true };
}

// Must match the queue name used by BullMqQueueService when publishing.
const queueName = "ecommerce-events";
/** The BullMQ worker; exported so it can be closed or inspected by other code. */
export const emailWorker = new Worker(queueName, processEmailJob, {
  // `true` selects the worker variant of the connection options (see redisQueueConnection).
  connection: redisQueueConnection(true),
  concurrency: 3,
});
emailWorker.on("completed", (job) =>
  logger.info({ jobId: job.id, eventName: job.name }, "Email job completed"),
);
emailWorker.on("failed", (job, err) =>
  logger.error(
    { jobId: job?.id, eventName: job?.name, err },
    "Email job failed",
  ),
);

// Run outbox publisher in worker process; API doesn't need to reach Redis to commit an order.
// Every 3s, flush a batch of unpublished outbox rows. The flag stops a slow poll
// from overlapping the next tick, which would publish the same rows twice at once.
let pollInProgress = false;
const outboxInterval = setInterval(async () => {
  if (pollInProgress) return;
  pollInProgress = true;
  try {
    await flushOutboxBatch();
  } catch (err) {
    logger.warn({ err }, "Outbox poll failed");
  } finally {
    pollInProgress = false;
  }
}, 3000);

/**
 * Stops the poller first (so no new work is started), then closes the worker,
 * queue and database connection before exiting.
 */
async function shutdown(signal: string) {
  logger.info({ signal }, "Stopping email worker and outbox poller");
  clearInterval(outboxInterval);
  await emailWorker.close();
  await bullMqQueueService.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
logger.info({ queueName }, "Email worker and outbox publisher started");
