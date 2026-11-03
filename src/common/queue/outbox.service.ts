import { prisma } from "../../config/prisma.js";
import { bullMqQueueService } from "./bullmqQueue.service.js";
import { logger } from "../logger.js";

/** Enqueue committed outbox rows. A crash before publishedAt may enqueue again;
 * BullMQ jobId reduces duplicates, and consumers must tolerate at-least-once delivery. */
export async function flushOutboxBatch(limit = 25): Promise<number> {
  const events = await prisma.outboxEvent.findMany({
    where: { publishedAt: null }, orderBy: { createdAt: "asc" }, take: limit,
  });
  let flushed = 0;
  for (const event of events) {
    try {
      await bullMqQueueService.publish(event.eventType, event.payload, event.id);
      await prisma.outboxEvent.update({ where: { id: event.id },
        data: { publishedAt: new Date(), attempts: { increment: 1 }, lastError: null } });
      flushed++;
    } catch (error) {
      await prisma.outboxEvent.update({ where: { id: event.id },
        data: { attempts: { increment: 1 }, lastError: error instanceof Error ? error.message.slice(0, 200) : "Unknown error" } });
      logger.error({ outboxId: event.id, eventType: event.eventType }, "Outbox enqueue failed; will retry");
      break;
    }
  }
  return flushed;
}
