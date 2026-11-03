import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { testRequest } from "./testHelper.js";
import app from "../app.js";
import { prisma } from "../config/prisma.js";
import { generateAccessToken } from "../common/token.js";
import { bullMqQueueService } from "../common/queue/bullmqQueue.service.js";
import { disconnectRedis } from "../config/redis.js";

let adminId: string, customerId: string, adminToken: string, customerToken: string;
let adminEmail: string, customerEmail: string;
const productIds: string[] = [];
const orderIds: string[] = [];
let isDbAvailable = false;

before(async () => {
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    isDbAvailable = true;
  } catch {
    console.warn("⚠️ PostgreSQL not reachable on port 5433; skipping live database integration checks in commerce test.");
    return;
  }

  const adminRole = await prisma.role.upsert({ where: { name: "ADMIN" }, create: { name: "ADMIN" }, update: {} });
  const userRole = await prisma.role.upsert({ where: { name: "USER" }, create: { name: "USER" }, update: {} });
  adminEmail = `admin-${randomUUID()}@example.com`;
  customerEmail = `customer-${randomUUID()}@example.com`;
  const passwordHash = await argon2.hash("StrongTestPassword123!");
  const admin = await prisma.user.create({ data: { email: adminEmail, passwordHash,
    roles: { create: { roleId: adminRole.id } } } });
  const customer = await prisma.user.create({ data: { email: customerEmail, passwordHash,
    roles: { create: { roleId: userRole.id } } } });
  adminId = admin.id; customerId = customer.id;
  adminToken = generateAccessToken({ userId: admin.id, email: admin.email, roles: ["ADMIN"] });
  customerToken = generateAccessToken({ userId: customer.id, email: customer.email, roles: ["USER"] });
});

after(async () => {
  if (isDbAvailable) {
    const outboxSources = [...orderIds.map(id => `order:${id}:created`)];
    await prisma.outboxEvent.deleteMany({ where: { sourceId: { in: outboxSources } } }).catch(() => {});
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } }).catch(() => {});
    await prisma.product.deleteMany({ where: { id: { in: productIds } } }).catch(() => {});
    if (adminId && customerId) {
      await prisma.user.deleteMany({ where: { id: { in: [adminId, customerId] } } }).catch(() => {});
    }
  }
  await bullMqQueueService.close();
  await disconnectRedis();
  await prisma.$disconnect();
});

describe("commerce integration and security invariants", () => {
  it("rejects public product creation and accepts ADMIN creation", async (t) => {
    if (!isDbAvailable) {
      t.skip("PostgreSQL not reachable on port 5433");
      return;
    }
    const payload = { name: "Test Item", description: "Integration test", price: 9.99, currency: "USD", stock: 1 };
    const blocked = await testRequest(app).post("/api/v1/products").set("Authorization", `Bearer ${customerToken}`).send(payload);
    assert.equal(blocked.status, 403);
    const created = await testRequest(app).post("/api/v1/products").set("Authorization", `Bearer ${adminToken}`).send(payload);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    productIds.push(created.body.data.id);
  });
  it("reserves at most one last-stock item under concurrent requests", async (t) => {
    if (!isDbAvailable) {
      t.skip("PostgreSQL not reachable on port 5433");
      return;
    }
    const payload = { items: [{ productId: productIds[0]!, quantity: 1 }] };
    const responses = await Promise.all([
      testRequest(app).post("/api/v1/orders").set("Authorization", `Bearer ${customerToken}`).send(payload),
      testRequest(app).post("/api/v1/orders").set("Authorization", `Bearer ${customerToken}`).send(payload),
    ]);
    assert.equal(responses.filter(r => r.status === 201).length, 1);
    const won = responses.find(r => r.status === 201)!;
    orderIds.push(won.body.data.id);
    const inventory = await prisma.inventory.findUniqueOrThrow({ where: { productId: productIds[0]! } });
    assert.equal(inventory.availableQuantity, 0);
    assert.equal(inventory.reservedQuantity, 1);
    assert.equal(won.body.data.totalAmount, "9.99");
  });
  it("prevents another user from inspecting order details", async (t) => {
    if (!isDbAvailable) {
      t.skip("PostgreSQL not reachable on port 5433");
      return;
    }
    const result = await testRequest(app).get(`/api/v1/orders/${orderIds[0]}`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(result.status, 200); // ADMIN may view another user's order
    const stranger = await prisma.user.create({ data: { email: `stranger-${randomUUID()}@example.com`, passwordHash: "x" } });
    try {
      const token = generateAccessToken({ userId: stranger.id, email: stranger.email, roles: [] });
      const denied = await testRequest(app).get(`/api/v1/orders/${orderIds[0]}`).set("Authorization", `Bearer ${token}`);
      assert.equal(denied.status, 403);
    } finally { await prisma.user.delete({ where: { id: stranger.id } }); }
  });
  it("releases stock exactly once when cancelling an order", async (t) => {
    if (!isDbAvailable) {
      t.skip("PostgreSQL not reachable on port 5433");
      return;
    }
    const url = `/api/v1/orders/${orderIds[0]}/cancel`;
    const first = await testRequest(app).post(url).set("Authorization", `Bearer ${customerToken}`);
    const again = await testRequest(app).post(url).set("Authorization", `Bearer ${customerToken}`);
    assert.equal(first.status, 200);
    assert.notEqual(again.status, 200);
    const inventory = await prisma.inventory.findUniqueOrThrow({ where: { productId: productIds[0]! } });
    assert.equal(inventory.availableQuantity, 1);
    assert.equal(inventory.reservedQuantity, 0);
  });
  it("rejects an unsigned Stripe webhook", async () => {
    const response = await testRequest(app).post("/api/v1/webhooks/stripe")
      .set("Content-Type", "application/json").send({ id: "evt_forged", type: "checkout.session.completed" });
    assert.equal(response.status, 401);
  });
  it("does not accept a mock Google identity via callback query parameters", async () => {
    const result = await testRequest(app).get("/api/v1/auth/google/callback?mockSub=forged&mockEmail=attacker@example.com");
    assert.equal(result.status, 401);
  });
  it("rotates refresh cookies once and revokes on logout", async (t) => {
    if (!isDbAvailable) {
      t.skip("PostgreSQL not reachable on port 5433");
      return;
    }
    const logged = await testRequest(app).post("/api/v1/auth/login")
      .send({ email: customerEmail, password: "StrongTestPassword123!" });
    assert.equal(logged.status, 200);
    assert.equal(logged.body.data.refreshToken, undefined);
    const cookie = logged.headers["set-cookie"] as string[];
    assert.ok(Array.isArray(cookie) && cookie.length > 0);
    const rotated = await testRequest(app).post("/api/v1/auth/refresh").set("Cookie", cookie);
    assert.equal(rotated.status, 200);
    const replay = await testRequest(app).post("/api/v1/auth/refresh").set("Cookie", cookie);
    assert.equal(replay.status, 401);
    const newCookie = rotated.headers["set-cookie"] as string[];
    const logoutRes = await testRequest(app).post("/api/v1/auth/logout").set("Cookie", newCookie);
    assert.equal(logoutRes.status, 200);
    const refreshAfterLogout = await testRequest(app).post("/api/v1/auth/refresh").set("Cookie", newCookie);
    assert.equal(refreshAfterLogout.status, 401);
  });
});
