import "express";

declare global {
  interface Request {
    requestId?: string;
  }
}

export {};