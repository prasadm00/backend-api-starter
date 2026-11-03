import { Queue, type ConnectionOptions } from "bullmq";
import type { QueueService } from "./queue.interface.js";
import { localQueueService } from "./localQueue.service.js";
import { logger } from "../logger.js";
import { env } from "../../config/env.js";

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

  private getQueue(): Queue | null {
    if (env.NODE_ENV === "test") {
      return null;
    }
    if (!this.queue) {
      try {
        this.queue = new Queue("ecommerce-events", { connection: redisQueueConnection() });
      } catch (err) {
        logger.warn({ err }, "BullMQ queue initialization failed; using local fallback");
        return null;
      }
    }
    return this.queue;
  }

  async publish(eventName: string, payload: unknown, jobId?: string): Promise<void> {
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
        logger.warn({ err, eventName }, "Failed to push to BullMQ queue; recorded locally");
      }
    }
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
  }
}

export const bullMqQueueService = new BullMqQueueService();
