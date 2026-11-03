export interface QueueService { publish(eventName: string, payload: unknown, jobId?: string): Promise<void>; }
