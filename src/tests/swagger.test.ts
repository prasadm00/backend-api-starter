import { describe, it } from "node:test";
import assert from "node:assert";
import app from "../app";
import { testRequest } from "./testHelper";

describe("Swagger API Documentation", () => {
  it("GET /docs/json returns valid OpenAPI 3.0 specification", async () => {
    const res = await testRequest(app).get("/docs/json");

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.openapi, "3.0.0");
    assert.strictEqual(res.body.info.title, "Backend API Documentation");
    assert.ok(res.body.paths["/health/live"]);
    assert.ok(res.body.paths["/health/ready"]);
    assert.ok(res.body.paths["/api/v1/auth/register"]);
    assert.ok(res.body.paths["/api/v1/auth/login"]);
    assert.ok(res.body.paths["/api/v1/auth/refresh"]);
    assert.ok(res.body.paths["/api/v1/auth/logout"]);
    assert.ok(res.body.paths["/api/v1/admin/health"]);
  });

  it("GET /docs serves Swagger UI HTML", async () => {
    const res = await testRequest(app).get("/docs/");

    assert.strictEqual(res.status, 200);
    assert.ok(res.text.includes("swagger-ui") || res.text.includes("Swagger UI") || res.text.includes("html"));
  });
});
