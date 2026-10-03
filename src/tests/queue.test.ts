import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { LocalQueueService, type QueueService } from "../common/queue";
import { registerUser } from "../modules/auth/auth.service";

describe("Task 22 & 23: Queue Abstraction and USER_REGISTERED Event", () => {
  let queue: LocalQueueService;

  beforeEach(() => {
    queue = new LocalQueueService();
  });

  describe("Task 22: QueueService abstraction & LocalQueueService adapter", () => {
    it("publishes and records events in LocalQueueService", async () => {
      await queue.publish("TEST_EVENT", { foo: "bar" });
      const events = queue.getEvents();

      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0]?.eventName, "TEST_EVENT");
      assert.deepStrictEqual(events[0]?.payload, { foo: "bar" });
      assert.ok(events[0]?.timestamp instanceof Date);
    });

    it("satisfies the QueueService interface contract", async () => {
      const genericQueue: QueueService = queue;
      await genericQueue.publish("GENERIC_EVENT", { count: 42 });

      const events = queue.getEventsByName("GENERIC_EVENT");
      assert.strictEqual(events.length, 1);
      assert.deepStrictEqual(events[0]?.payload, { count: 42 });
    });
  });

  describe("Task 23: Publish USER_REGISTERED after registration", () => {
    it("publishes USER_REGISTERED event with userId and email after DB commit", async () => {
      const mockUser = {
        id: "mock-uuid-1234",
        email: "alice@example.com",
        passwordHash: "hash",
        createdAt: new Date(),
        updatedAt: new Date(),
        status: "ACTIVE" as const,
        roles: [{ role: { id: "r1", name: "USER" }, userId: "mock-uuid-1234", roleId: "r1" }],
      };

      const result = await registerUser(
        { email: "alice@example.com", password: "Password123!" },
        {
          findUserByEmail: async () => null,
          createUser: async () => mockUser,
          queue,
        },
      );

      assert.strictEqual(result.id, "mock-uuid-1234");
      assert.strictEqual(result.email, "alice@example.com");

      // Verify event was published
      const publishedEvents = queue.getEventsByName("USER_REGISTERED");
      assert.strictEqual(publishedEvents.length, 1);
      assert.deepStrictEqual(publishedEvents[0]?.payload, {
        userId: "mock-uuid-1234",
        email: "alice@example.com",
      });
    });

    it("does NOT publish USER_REGISTERED if user already exists (before DB commit)", async () => {
      let createUserCalled = false;

      await assert.rejects(
        async () => {
          await registerUser(
            { email: "existing@example.com", password: "Password123!" },
            {
              findUserByEmail: async () => ({ id: "existing-id", email: "existing@example.com" } as any),
              createUser: async () => {
                createUserCalled = true;
                throw new Error("Should not be called");
              },
              queue,
            },
          );
        },
        { name: "ConflictError" },
      );

      assert.strictEqual(createUserCalled, false);
      const publishedEvents = queue.getEventsByName("USER_REGISTERED");
      assert.strictEqual(publishedEvents.length, 0);
    });

    it("does NOT publish USER_REGISTERED if DB transaction fails during createUser", async () => {
      await assert.rejects(
        async () => {
          await registerUser(
            { email: "fail@example.com", password: "Password123!" },
            {
              findUserByEmail: async () => null,
              createUser: async () => {
                throw new Error("DB Transaction Rolled Back");
              },
              queue,
            },
          );
        },
        { message: "DB Transaction Rolled Back" },
      );

      const publishedEvents = queue.getEventsByName("USER_REGISTERED");
      assert.strictEqual(publishedEvents.length, 0);
    });
  });
});
