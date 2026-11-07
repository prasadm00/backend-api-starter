/**
 * Queue abstraction, so callers don't depend on a specific broker.
 */
export interface QueueService {
  /**
   * Publishes an event.
   * @param jobId Optional idempotency key; implementations may use it to de-duplicate.
   */
  publish(eventName: string, payload: unknown, jobId?: string): Promise<void>;
}
