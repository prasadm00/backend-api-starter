export interface QueueService {
  publish(eventName: string, payload: unknown): Promise<void>;
}
