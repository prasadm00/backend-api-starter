-- Transactional event delivery; consumers are at-least-once and must be idempotent.
CREATE TABLE "OutboxEvent" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OutboxEvent_sourceId_key" ON "OutboxEvent"("sourceId");
CREATE INDEX "OutboxEvent_publishedAt_createdAt_idx" ON "OutboxEvent"("publishedAt", "createdAt");
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_nonnegative_available" CHECK ("availableQuantity" >= 0);
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_nonnegative_reserved" CHECK ("reservedQuantity" >= 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_positive_quantity" CHECK ("quantity" > 0);
