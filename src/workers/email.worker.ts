import { Worker, type Job } from "bullmq";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { logger } from "../common/logger.js";
import { redisQueueConnection, bullMqQueueService } from "../common/queue/bullmqQueue.service.js";
import { flushOutboxBatch } from "../common/queue/outbox.service.js";

interface EmailPayload { to: string; subject: string; text: string; idempotencyKey: string }
async function deliver(payload: EmailPayload): Promise<void> {
  if (env.EMAIL_TRANSPORT === "log") {
    // Explicitly a SIMULATED transport; no message was delivered.
    if (env.NODE_ENV === "production") throw new Error("Log email transport cannot deliver production emails");
    logger.info({ idempotencyKey: payload.idempotencyKey, subject: payload.subject }, "SIMULATED EMAIL ONLY - NOT SENT");
    return;
  }
  if (!env.EMAIL_API_URL || !env.EMAIL_API_KEY) throw new Error("EMAIL_API_URL and EMAIL_API_KEY are required for webhook transport");
  const response = await fetch(env.EMAIL_API_URL, {
    method: "POST", headers: {
      "content-type": "application/json", authorization: `Bearer ${env.EMAIL_API_KEY}`,
      "idempotency-key": payload.idempotencyKey,
    },
    body: JSON.stringify({ to: payload.to, subject: payload.subject, text: payload.text }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Email transport rejected job: HTTP ${response.status}`);
}

async function processEmailJob(job: Job): Promise<{ processed: boolean }> {
  const data = job.data as Record<string, unknown>;
  let email: string | undefined;
  if (typeof data.email === "string") email = data.email;
  if (!email && typeof data.userId === "string") {
    const user = await prisma.user.findUnique({ where: { id: data.userId }, select: { email: true } });
    email = user?.email;
  }
  if (!email && typeof data.orderId === "string") {
    const order = await prisma.order.findUnique({ where: { id: data.orderId }, select: { user: { select: { email: true } } } });
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
  await deliver({ to: email, subject,
    text: `${subject}. Reference: ${String(data.orderId ?? data.userId ?? job.id)}.`,
    idempotencyKey: String(job.id),
  });
  return { processed: true };
}

const queueName = "ecommerce-events";
export const emailWorker = new Worker(queueName, processEmailJob, {
  connection: redisQueueConnection(true), concurrency: 3,
});
emailWorker.on("completed", job => logger.info({ jobId: job.id, eventName: job.name }, "Email job completed"));
emailWorker.on("failed", (job, err) => logger.error({ jobId: job?.id, eventName: job?.name, err }, "Email job failed"));

// Run outbox publisher in worker process; API doesn't need to reach Redis to commit an order.
let pollInProgress = false;
const outboxInterval = setInterval(async () => {
  if (pollInProgress) return;
  pollInProgress = true;
  try { await flushOutboxBatch(); }
  catch (err) { logger.warn({ err }, "Outbox poll failed"); }
  finally { pollInProgress = false; }
}, 3000);

async function shutdown(signal: string) {
  logger.info({ signal }, "Stopping email worker and outbox poller");
  clearInterval(outboxInterval);
  await emailWorker.close();
  await bullMqQueueService.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => { void shutdown("SIGINT"); });
process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
logger.info({ queueName }, "Email worker and outbox publisher started");
