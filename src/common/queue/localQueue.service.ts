/**
 * In-memory queue adapter: keeps published events in this process only.
 * Used as a local record alongside BullMQ, and handy for inspecting events in tests.
 */
import type { QueueService } from "./queue.interface.js";
import { logger } from "../logger.js";

/** One recorded event. */
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

  /** Records and logs the event. Nothing is delivered anywhere; events are lost on restart. */
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

  /** Returns a copy of all recorded events, oldest first. */
  getEvents(): PublishedEvent[] {
    return [...this.events];
  }

  /** Returns recorded events with the given name. */
  getEventsByName(eventName: string): PublishedEvent[] {
    return this.events.filter((e) => e.eventName === eventName);
  }

  /** Discards all recorded events (e.g. between tests). */
  clear(): void {
    this.events = [];
  }
}

/** Shared instance used by `BullMqQueueService` for its local record. */
export const localQueueService = new LocalQueueService();
