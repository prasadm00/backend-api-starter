# Development & Operations Guide

This guide covers local environment setup, container management, database migrations, seeding, and automated testing workflows.

---

## 1. Local Environment Prerequisites

* **Node.js**: v20 or newer (`node -v`)
* **Docker & Docker Compose**: v2+ (`docker compose version`)
* **npm**: v10+

---

## 2. Environment Variables Reference

Create a `.env` file in the project root:

```env
# Server
PORT=3000
NODE_ENV=development

# PostgreSQL (matching docker-compose.yml port mapping 5433:5432)
DATABASE_URL=postgresql://postgres:mysecretpassword@127.0.0.1:5433/my_database

# Redis (matching docker-compose.yml port 6379)
REDIS_URL=redis://localhost:6379

# JWT Authentication
JWT_SECRET=super-secret-jwt-key-with-at-least-32-characters-minimum
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
```

Variables are validated at startup via **Zod** in [`src/config/env.ts`](../../src/config/env.ts). If any required variable is missing or invalid, the process will fail fast with a descriptive error tree.

---

## 3. Docker Container Management

PostgreSQL and Redis run via `docker-compose.yml`:

```bash
# Start all infrastructure containers in the background
docker compose up -d

# Check status of running containers
docker compose ps

# View live logs for PostgreSQL
docker compose logs -f db

# View live logs for Redis
docker compose logs -f cache

# Access PostgreSQL psql shell inside container
docker compose exec db psql -U postgres -d my_database

# Access Redis CLI inside container
docker compose exec cache redis-cli

# Stop containers (preserves data in volumes)
docker compose down

# Stop containers and wipe all volume data
docker compose down -v
```

---

## 4. Prisma 7 Database Workflows

Prisma 7 uses the `@prisma/adapter-pg` driver adapter. Database URLs live in `prisma.config.ts`.

```bash
# Run migrations and apply pending changes
npx prisma migrate dev --name <migration_name>

# Regenerate Prisma Client TypeScript types
npx prisma generate

# Validate schema syntax without touching database
npx prisma validate

# Open Prisma Studio web visualizer
npx prisma studio
```

---

## 5. Seeding the Admin User

To create or refresh the administrator user account for testing:

```bash
npm run seed:admin
```

This runs [`scripts/seed-admin.ts`](../../scripts/seed-admin.ts), ensuring the `ADMIN` role is created in the database, hashing the password using Argon2, and assigning the role.

**Default Admin Credentials:**
* **Email:** `admin@example.com`
* **Password:** `AdminPassword123!`
* **Role:** `ADMIN`

To seed a custom admin user:
```bash
ADMIN_EMAIL=custom@example.com ADMIN_PASSWORD=CustomPass123! npm run seed:admin
```

---

## 6. Running the Application

### Development Server (with hot reloading)
```bash
npm run dev
```
The server listens at `http://localhost:3000`.

### Production Build & Execution
```bash
# Compile TypeScript to JavaScript in /dist
npm run build

# Start the compiled application
npm start
```

---

## 7. Automated Test Suite

Integration tests run with Node's native test runner via `tsx`:

```bash
npm test
```

### Test Suites Inventory
* [`src/tests/rbac-admin.test.ts`](../../src/tests/rbac-admin.test.ts): RBAC middleware evaluation (401, 403, 200) and `/api/v1/admin/health` endpoint tests.
* [`src/tests/queue.test.ts`](../../src/tests/queue.test.ts): `LocalQueueService` contract and post-commit `USER_REGISTERED` event verification.
* [`src/tests/redis.test.ts`](../../src/tests/redis.test.ts): Redis client connection management and `SET/GET health:redis` contract.
* [`src/tests/health.test.ts`](../../src/tests/health.test.ts): Liveness probe (`200`) and Readiness probe (`200` healthy, `503` degraded).
* [`src/tests/swagger.test.ts`](../../src/tests/swagger.test.ts): Swagger UI and OpenAPI schema validation.
