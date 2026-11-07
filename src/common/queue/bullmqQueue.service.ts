/**
 * BullMQ (Redis) queue publisher.
 *
 * Implements `QueueService` for the "ecommerce-events" queue. Each publish is
 * also recorded in the in-memory `localQueueService`, and BullMQ errors are logged
 * rather than thrown, so a Redis problem does not fail the caller.
 */
import { Queue, type ConnectionOptions } from "bullmq";
import type { QueueService } from "./queue.interface.js";
import { localQueueService } from "./localQueue.service.js";
import { logger } from "../logger.js";
import { env } from "../../config/env.js";

/**
 * Builds BullMQ connection options from `REDIS_URL`.
 *
 * @param forWorker `true` for the worker's blocking connection, which BullMQ needs
 *   `maxRetriesPerRequest: null` for. The producer side uses 1 retry and no offline
 *   queue so a publish fails fast when Redis is down instead of hanging the request.
 */
export function redisQueueConnection(forWorker = false): ConnectionOptions {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    maxRetriesPerRequest: forWorker ? null : 1,
    enableOfflineQueue: false,
  };
}

export class BullMqQueueService implements QueueService {
  private queue: Queue | null = null;

  /**
   * Lazily creates the Queue on first use. Returns `null` in the test environment
   * (no Redis needed) or if construction fails; callers then rely on the local record.
   */
  private getQueue(): Queue | null {
    if (env.NODE_ENV === "test") {
      return null;
    }
    if (!this.queue) {
      try {
        this.queue = new Queue("ecommerce-events", {
          connection: redisQueueConnection(),
        });
      } catch (err) {
        logger.warn(
          { err },
          "BullMQ queue initialization failed; using local fallback",
        );
        return null;
      }
    }
    return this.queue;
  }

  /**
   * Enqueues an event job, retrying up to 4 attempts with exponential backoff
   * (1s base). Finished jobs are trimmed to the last 500 completed / failed.
   *
   * @param jobId Optional idempotency key. BullMQ ignores an add whose jobId already
   *   exists, so passing a stable id (the outbox passes the row id) avoids duplicate jobs.
   *
   * Never throws for BullMQ failures: they are logged and only the local record
   * remains. Callers therefore cannot detect a failed enqueue from this method.
   */
  async publish(
    eventName: string,
    payload: unknown,
    jobId?: string,
  ): Promise<void> {
    // Always record locally first, so the event is visible even without Redis.
    await localQueueService.publish(eventName, payload);

    const q = this.getQueue();
    if (q) {
      try {
        await q.add(eventName, payload, {
          ...(jobId ? { jobId } : {}),
          attempts: 4,
          backoff: { type: "exponential", delay: 1000 },
          removeOnComplete: 500,
          removeOnFail: 500,
        });
        logger.info({ eventName, jobId }, "BullMQ job enqueued");
      } catch (err) {
        logger.warn(
          { err, eventName },
          "Failed to push to BullMQ queue; recorded locally",
        );
      }
    }
  }

  /** Closes the Redis connection if a queue was opened. Called during graceful shutdown. */
  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
  }
}

/** Shared instance; also exported as `queueService` from `queue/index.ts`. */
export const bullMqQueueService = new BullMqQueueService();
