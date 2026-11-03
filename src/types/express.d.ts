import "express";
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      validatedQuery?: unknown;
      user?: { userId: string; email: string; roles: string[] };
    }
  }
}
export {};
