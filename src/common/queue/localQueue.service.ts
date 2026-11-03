import type { QueueService } from "./queue.interface.js";
import { logger } from "../logger.js";

export interface PublishedEvent {
  eventName: string;
  payload: unknown;
  timestamp: Date;
}

/**
 * Local queue adapter that logs events.
 * Implements QueueService interface so it can be swapped with SqsQueueService later.
 */
export class LocalQueueService implements QueueService {
  private events: PublishedEvent[] = [];

  async publish(eventName: string, payload: unknown): Promise<void> {
    const event: PublishedEvent = {
      eventName,
      payload,
      timestamp: new Date(),
    };
    this.events.push(event);

    logger.info(
      { eventName },
      `[LocalQueueService] Event published: ${eventName}`,
    );
  }

  getEvents(): PublishedEvent[] {
    return [...this.events];
  }

  getEventsByName(eventName: string): PublishedEvent[] {
    return this.events.filter((e) => e.eventName === eventName);
  }

  clear(): void {
    this.events = [];
  }
}

export const localQueueService = new LocalQueueService();
