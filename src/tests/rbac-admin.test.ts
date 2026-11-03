import { describe, it } from "node:test";
import assert from "node:assert/strict";
import app from "../app.js";
import { testRequest } from "./testHelper.js";
import { generateAccessToken } from "../common/token.js";
import { authorize } from "../middlewares/auth.js";
import { UnauthorizedError, ForbiddenError } from "../errors/AppError.js";

describe("Task 19 & 20: RBAC Middleware and Admin Route", () => {
  const userToken = generateAccessToken({
    userId: "user-123",
    email: "user@example.com",
    roles: ["USER"],
  });

  const adminToken = generateAccessToken({
    userId: "admin-123",
    email: "admin@example.com",
    roles: ["ADMIN"],
  });

  const multiRoleToken = generateAccessToken({
    userId: "super-123",
    email: "super@example.com",
    roles: ["USER", "ADMIN"],
  });

  describe("Task 19: authorize() middleware unit checks", () => {
    it("returns 401 when unauthenticated request (no req.user)", () => {
      const middleware = authorize("ADMIN");
      const req: any = {};
      const res: any = {};
      let errorThrown: any = null;

      middleware(req, res, (err?: any) => {
        errorThrown = err;
      });

      assert.ok(errorThrown instanceof UnauthorizedError);
      assert.equal(errorThrown.statusCode, 401);
      assert.equal(errorThrown.code, "UNAUTHORIZED");
    });

    it("returns 403 when authenticated but lacks role", () => {
      const middleware = authorize("ADMIN");
      const req: any = { user: { userId: "u1", email: "u1@test.com", roles: ["USER"] } };
      const res: any = {};
      let errorThrown: any = null;

      middleware(req, res, (err?: any) => {
        errorThrown = err;
      });

      assert.ok(errorThrown instanceof ForbiddenError);
      assert.equal(errorThrown.statusCode, 403);
      assert.equal(errorThrown.code, "FORBIDDEN");
    });

    it("calls next() with no error when user has required role", () => {
      const middleware = authorize("ADMIN");
      const req: any = { user: { userId: "a1", email: "a1@test.com", roles: ["ADMIN"] } };
      const res: any = {};
      let called = false;
      let errorThrown: any = null;

      middleware(req, res, (err?: any) => {
        called = true;
        errorThrown = err;
      });

      assert.equal(called, true);
      assert.equal(errorThrown, undefined);
    });
  });

  describe("Task 20: GET /api/v1/admin/health integration", () => {
    it("returns 401 when request is not authenticated (missing token)", async () => {
      const res = await testRequest(app).get("/api/v1/admin/health");
      assert.equal(res.status, 401);
      assert.equal(res.body.code, "UNAUTHORIZED");
    });

    it("returns 401 when request has invalid token", async () => {
      const res = await testRequest(app)
        .get("/api/v1/admin/health")
        .set("Authorization", "Bearer invalid.jwt.token");
      assert.equal(res.status, 401);
      assert.equal(res.body.code, "UNAUTHORIZED");
    });

    it("returns 403 when authenticated as USER (forbidden)", async () => {
      const res = await testRequest(app)
        .get("/api/v1/admin/health")
        .set("Authorization", `Bearer ${userToken}`);
      assert.equal(res.status, 403);
      assert.equal(res.body.code, "FORBIDDEN");
    });

    it("returns 200 when authenticated as ADMIN", async () => {
      const res = await testRequest(app)
        .get("/api/v1/admin/health")
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.status, "ok");
      assert.equal(res.body.message, "Admin health check passed");
    });

    it("returns 200 when user has both USER and ADMIN roles", async () => {
      const res = await testRequest(app)
        .get("/api/v1/admin/health")
        .set("Authorization", `Bearer ${multiRoleToken}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.status, "ok");
    });
  });
});
