# Production-Ready E-Commerce Backend API

A high-performance, resilient, and secure **E-Commerce Backend API** built with **Node.js 22**, **Express 5**, **TypeScript**, **Prisma 7**, **PostgreSQL 16**, **Redis 7**, **BullMQ**, and **Stripe**.

This backend implements a complete, fault-tolerant e-commerce lifecycle:
1. **Authentication & Identity**: Argon2 password hashing, stateless short-lived JWT access tokens, cryptographically secure opaque refresh tokens stored as SHA-256 digests in HttpOnly cookies, and strict Google OAuth 2.0 / OIDC with PKCE.
2. **Product & Inventory Management**: Full product CRUD with Zod validation, role-based access control (`ADMIN` vs `USER`), and high-performance Redis cache-aside with graceful fallback to PostgreSQL.
3. **Atomic Stock Reservation**: Concurrency-safe order placement preventing overselling under heavy load via database-level transaction row locks and conditional decrements.
4. **Stripe Test Checkout & Webhook Idempotency**: Card payment sessions with signature verification, raw request stream parsing, and idempotent database transaction state transitions.
5. **Durable Background Workers & Transactional Outbox**: Atomic database event outbox polling, BullMQ queueing with Redis, exponential backoff retries, and asynchronous order/registration confirmation processing.
6. **Containerization & CI/CD**: Multi-stage production `Dockerfile`, `docker-compose.yml`, and GitHub Actions automated testing workflow.

---

## 🏗️ Architecture & Component Flow

```mermaid
flowchart TD
    Client["Client / Postman / Frontend"] --> Express["Express 5 REST API"]
    Express --> Security["Security: Helmet, CORS, Rate Limit, RequestID, Pino"]
    Security --> AuthGuard["Auth Guard: JWT & DB Account Status & RBAC"]
    AuthGuard --> Controllers["Controllers (Zod Validation)"]
    Controllers --> Services["Domain Services"]
    Services --> Cache[("Redis Cache (Cache-Aside)")]
    Services --> Repos["Prisma 7 Repositories"]
    Repos --> Postgres[("PostgreSQL 16 (Source of Truth)")]
    Repos --> OutboxTable[("OutboxEvent (Atomic DB Commit)")]
    OutboxTable --> Poller["Outbox Poller Service"]
    Poller --> BullMQ["BullMQ Queue (Redis)"]
    BullMQ --> Worker["Asynchronous Email Worker"]
    Worker --> EmailGateway["Email Transport / Webhook"]
    Services --> StripeAPI["Stripe Checkout API"]
    StripeAPI --> StripeWebhook["Stripe Signed Webhook"]
    StripeWebhook --> Express
    GoogleAuth["Google Identity / OIDC JWKS"] --> Services
```

---

## ⚡ Concurrency & Payment Sequence Flows

### 1. Atomic Order Stock Reservation (Zero Overselling)

```mermaid
sequenceDiagram
    autonumber
    participant Customer as Customer Client
    participant API as Orders API
    participant DB as PostgreSQL (Transaction)
    participant Outbox as Outbox Table
    participant Worker as Background Worker

    Customer->>API: POST /api/v1/orders { items: [{ productId, quantity }] }
    Note over API: Snapshot current product prices from DB
    API->>DB: BEGIN TRANSACTION
    loop For each item in order
        API->>DB: UPDATE "Inventory" SET available = available - qty, reserved = reserved + qty WHERE productId = id AND available >= qty
        DB-->>API: Rows Affected (Must be 1)
    end
    alt Insufficient stock on any item
        API->>DB: ROLLBACK TRANSACTION
        API-->>Customer: 409 Conflict ("Insufficient available stock")
    else All items reserved
        API->>DB: INSERT INTO "Order" (status: 'PENDING_PAYMENT', expiresAt: +15m)
        API->>DB: INSERT INTO "OrderItem" (snapshot unitPrice, lineTotal)
        API->>DB: INSERT INTO "OutboxEvent" (eventType: 'ORDER_CREATED')
        API->>DB: COMMIT TRANSACTION
        API-->>Customer: 201 Created (Order Details & Reservation)
        Worker->>Outbox: Poll unpublished events
        Worker->>Worker: Enqueue ORDER_CREATED to BullMQ
    end
```

### 2. Stripe Checkout & Idempotent Webhook Finalization

```mermaid
sequenceDiagram
    autonumber
    participant Customer
    participant API as Backend API
    participant Stripe as Stripe Gateway
    participant DB as PostgreSQL
    participant Worker as BullMQ Worker

    Customer->>API: POST /api/v1/orders/:id/checkout
    API->>DB: Verify caller ownership, status = PENDING_PAYMENT, expiresAt > now
    API->>Stripe: Create Checkout Session (idempotencyKey: checkout:{orderId})
    Stripe-->>API: Session ID & Payment URL
    API->>DB: Store pending Payment record (stripeSessionId)
    API-->>Customer: { checkoutUrl }
    Customer->>Stripe: Complete Card Payment in Stripe Hosted UI
    Stripe->>API: POST /api/v1/webhooks/stripe (raw JSON + Stripe-Signature)
    API->>API: Verify Stripe webhook signature with signing secret
    API->>DB: BEGIN TRANSACTION
    API->>DB: INSERT INTO "PaymentEvent" (providerEventId)
    alt Duplicate Event (Unique Constraint Violation)
        API->>DB: ROLLBACK TRANSACTION
        API-->>Stripe: 200 OK (Duplicate event safely acknowledged)
    else First Delivery
        API->>DB: Verify order status == 'PENDING_PAYMENT'
        API->>DB: UPDATE "Order" SET status = 'PAID'
        API->>DB: UPDATE "Inventory" SET reserved = reserved - qty (Sold)
        API->>DB: UPDATE "Payment" SET status = 'COMPLETED'
        API->>DB: INSERT INTO "OutboxEvent" (eventType: 'PAYMENT_CONFIRMED')
        API->>DB: COMMIT TRANSACTION
        API-->>Stripe: 200 OK (Event processed successfully)
        Worker->>DB: Read Outbox & Enqueue email confirmation
    end
```

---

## 🗄️ Database Entity-Relationship Model

```mermaid
erDiagram
    User ||--o{ UserRole : has
    Role ||--o{ UserRole : assigned
    User ||--o{ RefreshToken : owns
    User ||--o{ OAuthAccount : links
    User ||--o{ Product : creates
    User ||--o{ Order : places
    Product ||--o| Inventory : manages
    Product ||--o{ OrderItem : included_in
    Order ||--o{ OrderItem : contains
    Order ||--o{ Payment : generates
    PaymentEvent {
        string id PK
        string provider
        string providerEventId UK
        string eventType
        datetime processedAt
    }
    OutboxEvent {
        string id PK
        string sourceId UK
        string eventType
        json payload
        datetime createdAt
        datetime publishedAt
    }
```

---

## 🔒 Security & Resilience Invariants

| Invariant | Implementation Mechanism | Threat Mitigated |
|---|---|---|
| **Token Theft & Replay** | Opaque cryptographically random tokens; only SHA-256 hashes (`tokenHash`) stored in DB; transported via `HttpOnly`, `SameSite: strict` cookies. Atomic token rotation with compare-and-swap. | Cross-Site Scripting (XSS), token replay attacks, database leak exposure. |
| **Overselling Race Conditions** | Atomic conditional inventory reservation (`availableQuantity >= quantity`) inside a database transaction with price snapshotting. | Concurrency race conditions, negative inventory, checkout price tampering. |
| **Webhook Forgery & Duplicates** | Raw request body parsing before `express.json()`; cryptographic HMAC signature verification; unique `providerEventId` deduplication in DB transaction. | Man-in-the-middle forging, payment replay attacks, double fulfillment. |
| **Crash Consistency Gap** | Transactional Outbox Pattern: events committed to PostgreSQL in the exact same transaction as the domain change, then asynchronously drained into BullMQ. | Lost events caused by Redis / network outages occurring right after database commit. |
| **Privilege Escalation** | RBAC middleware re-verifies account active status and current roles against PostgreSQL on sensitive routes. | Stale JWT claims after role demotion or account deactivation (`DISABLED`). |

---

## 🚀 Quick Start Guide

### Prerequisites
- **Node.js**: v20+ (tested on Node v26 and v22)
- **npm**: v10+
- **Docker & Docker Compose**: (for containerized DB and Redis)

### 1. Installation & Environment Configuration
```bash
# Clone the repository and enter directory
cd 01-backend-api

# Install dependencies cleanly
npm ci

# Create your environment file from template
cp .env.example .env
```

Ensure `.env` contains valid configuration:
```env
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://postgres:mysecretpassword@127.0.0.1:5433/my_database
REDIS_URL=redis://localhost:6379
JWT_SECRET=super-secret-jwt-key-with-at-least-32-characters-minimum
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
STRIPE_SECRET_KEY=sk_test_placeholder
STRIPE_WEBHOOK_SECRET=whsec_placeholder
```

### 2. Database & Redis Setup
```bash
# Start PostgreSQL (port 5433) and Redis (port 6379)
docker compose up -d db cache

# Generate Prisma Client (Prisma 7 with pg adapter)
npx prisma generate

# Apply migrations
npm run migrate

npm run db:generate

npm run dev

npm run db:deploy

# (Optional) Seed an Admin user for testing
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=AdminSecurePassword123! npm run seed:admin
```

### 3. Build & Run Application
```bash
# Static typecheck
npm run typecheck

# Production bundle (bundles server & worker to dist/ via esbuild)
npm run build

# Start API in development watch mode
npm run dev

# Start worker in a separate terminal
npm run worker
```

The server will start on `http://localhost:3000`.
- **Health Live**: `GET http://localhost:3000/health/live`
- **Health Ready**: `GET http://localhost:3000/health/ready`
- **Swagger Documentation UI**: `http://localhost:3000/docs/`
- **OpenAPI JSON Spec**: `GET http://localhost:3000/docs/json`

---

## 🧪 Testing

The test suite runs using Node's built-in test runner (`tsx --test`) with an in-memory stream harness (`testHelper.ts`) that runs seamlessly in sandboxed environments without requiring loopback network permissions:

```bash
# Run all unit, integration, and security tests
NODE_ENV=test npm test
```

### Verified Test Matrix
- ✅ **Task 19 & 20**: RBAC Middleware & Admin Health Integration (401 unauthenticated, 403 USER forbidden, 200 ADMIN allowed).
- ✅ **Task 21**: Redis Connection & Infrastructure Integration (`SET health:redis ok`, `GET health:redis`).
- ✅ **Task 22 & 23**: Queue Abstraction & `USER_REGISTERED` post-commit event publishing.
- ✅ **Task 24**: Liveness (process uptime) and Readiness (database + cache connectivity probes).
- ✅ **Commerce Security**: Unsigned Stripe webhook rejection (401), Google OAuth query forgery rejection (401).
- ✅ **Swagger API**: Interactive UI and OpenAPI 3.0 specification conformance.

---

## 📚 API Endpoints Summary

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/v1/auth/register` | Public | Register new customer; publishes `USER_REGISTERED` event |
| `POST` | `/api/v1/auth/login` | Public | Authenticate credentials; returns access JWT and sets HttpOnly refresh cookie |
| `POST` | `/api/v1/auth/refresh` | Public (Cookie) | Atomic single-use refresh token rotation |
| `POST` | `/api/v1/auth/logout` | Authenticated | Revoke refresh token and clear cookie |
| `GET` | `/api/v1/users/me` | Authenticated | Fetch current authenticated user profile |
| `GET` | `/api/v1/products` | Public | Paginated product list with search and Redis caching |
| `GET` | `/api/v1/products/:id` | Public | Single product details (cached with Redis cache-aside) |
| `POST` | `/api/v1/products` | `ADMIN` | Create new product and inventory record; invalidates cache |
| `PATCH` | `/api/v1/products/:id` | `ADMIN` | Update product details; invalidates cache |
| `PATCH` | `/api/v1/products/:id/status` | `ADMIN` | Activate or deactivate product |
| `POST` | `/api/v1/orders` | Authenticated | Atomically reserve inventory and create pending order |
| `GET` | `/api/v1/orders` | Authenticated | List caller's orders (with pagination) |
| `GET` | `/api/v1/orders/:id` | Owner or `ADMIN` | View order details and line item snapshots |
| `POST` | `/api/v1/orders/:id/cancel` | Owner or `ADMIN` | Cancel order and release reserved inventory |
| `POST` | `/api/v1/orders/:id/checkout` | Authenticated | Create Stripe Checkout session for pending order |
| `GET` | `/api/v1/orders/:id/payment` | Owner or `ADMIN` | Inspect payment status for order |
| `POST` | `/api/v1/webhooks/stripe` | Stripe Signature | Signature-verified idempotent Stripe webhook processor |
| `GET` | `/health/live` | Public | Process liveness check |
| `GET` | `/health/ready` | Public | Dependency readiness check (PostgreSQL & Redis) |
| `GET` | `/docs` | Public | Interactive Swagger API documentation UI |
| `GET` | `/docs/json` | Public | Raw OpenAPI 3.0 JSON specification |

---

## 📖 Systematic Documentation Index

Detailed engineering guides are organized in the [`docs/`](docs/) directory:

- 🏛️ **Architecture & Data**:
  - [`docs/architecture/overview.md`](docs/architecture/overview.md) — Layered architectural flow and component responsibilities.
  - [`docs/architecture/data-model.md`](docs/architecture/data-model.md) — Database schema, transaction boundaries, and index strategies.
  - [`docs/architecture/decisions.md`](docs/architecture/decisions.md) — Architectural decision records (ADRs) explaining tradeoffs.
- 🔐 **Security & Access Control**:
  - [`docs/security/authentication.md`](docs/security/authentication.md) — Token hashing, atomic rotation, cookie transport, and Google OIDC.
  - [`docs/security/rbac.md`](docs/security/rbac.md) — Role-based access control, resource ownership checks, and status guards.
- ⚙️ **Infrastructure & Messaging**:
  - [`docs/infrastructure/queue.md`](docs/infrastructure/queue.md) — BullMQ job processing and Transactional Outbox pattern.
  - [`docs/infrastructure/redis.md`](docs/infrastructure/redis.md) — Redis cache-aside, key naming conventions, and failover behavior.
  - [`docs/infrastructure/health-checks.md`](docs/infrastructure/health-checks.md) — Liveness and readiness probe semantics for container orchestrators.
- 🛠️ **Operations & Runbooks**:
  - [`docs/operations/development-guide.md`](docs/operations/development-guide.md) — Local development workflow and third-party credential setup.
  - [`docs/operations/failure-scenarios.md`](docs/operations/failure-scenarios.md) — Disaster recovery: DB outage, Redis downtime, webhook replay, worker crashes.
  - [`docs/operations/aws-deployment.md`](docs/operations/aws-deployment.md) — Production AWS ECS/Fargate + RDS + ElastiCache deployment runbook.
  - [`docs/review/interview-guide.md`](docs/review/interview-guide.md) — System design interview prompts, Feynman-style explanations, and resume bullets.

---

## 📜 Key NPM Scripts

| Script | Command | Purpose |
|---|---|---|
| `npm run dev` | `tsx watch src/server.ts` | Starts development server with live reload |
| `npm run typecheck` | `tsc --noEmit` | Strict static type checking |
| `npm run build` | `tsc --noEmit && esbuild ...` | Compiles and bundles API server & worker to `dist/` |
| `npm start` | `node dist/server.js` | Runs compiled production API server |
| `npm run worker` | `tsx src/workers/email.worker.ts` | Runs BullMQ email worker in development |
| `npm run worker:prod` | `node dist/workers/email.worker.js` | Runs compiled production background worker |
| `npm test` | `tsx --test src/tests/*.test.ts` | Executes full automated test suite |
| `npm run migrate` | `prisma migrate dev` | Applies Prisma migrations |
| `npm run seed:admin` | `tsx scripts/seed-admin.ts` | Seeds an admin user safely using environment variables |
