import http from "node:http";
import { PassThrough } from "node:stream";
import type { Application } from "express";

export interface TestResponse {
  status: number;
  statusCode: number;
  headers: Record<string, string | string[] | undefined | number>;
  header: (name: string) => string | string[] | undefined | number;
  body: any;
  text: string;
}

export class TestRequestBuilder {
  private app: Application;
  private method: string;
  private path: string;
  private headers: Record<string, string> = {};
  private payload: any = null;

  constructor(app: Application, method: string, path: string) {
    this.app = app;
    this.method = method;
    this.path = path;
  }

  set(headerName: string, value: string): this {
    this.headers[headerName.toLowerCase()] = value;
    return this;
  }

  send(data: any): this {
    this.payload = data;
    return this;
  }

  async end(): Promise<TestResponse> {
    return new Promise((resolve, reject) => {
      const socket = new PassThrough();
      const req = new http.IncomingMessage(socket as any);
      req.method = this.method;
      req.url = this.path;
      req.headers = { host: "localhost", ...this.headers };

      let bodyData = "";
      if (this.payload !== null && this.payload !== undefined) {
        if (typeof this.payload === "object") {
          bodyData = JSON.stringify(this.payload);
          if (!req.headers["content-type"]) {
            req.headers["content-type"] = "application/json";
          }
        } else {
          bodyData = String(this.payload);
        }
        req.headers["content-length"] = Buffer.byteLength(bodyData).toString();
      }

      const res = new http.ServerResponse(req);
      let rawResponseBody = "";

      res.write = (chunk: any) => {
        if (chunk) rawResponseBody += chunk.toString();
        return true;
      };

      res.end = (chunk: any) => {
        if (chunk) rawResponseBody += chunk.toString();

        let parsedBody: any = null;
        try {
          parsedBody = JSON.parse(rawResponseBody);
        } catch {
          parsedBody = rawResponseBody;
        }

        const headers = res.getHeaders();
        const response: TestResponse = {
          status: res.statusCode,
          statusCode: res.statusCode,
          headers,
          header: (name: string) => headers[name.toLowerCase()],
          body: parsedBody,
          text: rawResponseBody,
        };

        resolve(response);
        return res;
      };

      if (bodyData) {
        process.nextTick(() => {
          req.push(bodyData);
          req.push(null);
        });
      } else {
        process.nextTick(() => {
          req.push(null);
        });
      }

      try {
        this.app(req as any, res as any);
      } catch (err) {
        reject(err);
      }
    });
  }

  then<TResult1 = TestResponse, TResult2 = never>(
    onfulfilled?: ((value: TestResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.end().then(onfulfilled, onrejected);
  }
}

export function testRequest(app: Application) {
  return {
    get: (path: string) => new TestRequestBuilder(app, "GET", path),
    post: (path: string) => new TestRequestBuilder(app, "POST", path),
    put: (path: string) => new TestRequestBuilder(app, "PUT", path),
    delete: (path: string) => new TestRequestBuilder(app, "DELETE", path),
  };
}
