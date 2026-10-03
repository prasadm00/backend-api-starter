# Backend API & Architecture Reference

A production-ready RESTful backend built with **Node.js**, **Express 5**, **TypeScript**, **Prisma 7** (PostgreSQL driver adapter), **Redis**, and **Pino**. Features JWT authentication with role-based access control (RBAC), queue abstraction with event publishing, Kubernetes-compliant health probes, and interactive Swagger documentation.

---

## 📚 Documentation Hub

Complete technical documentation is organized in the [`docs/`](./docs/README.md) directory:

* **[Architecture Overview](./docs/architecture/overview.md)** — Layered architecture, request pipeline, design patterns.
* **[Data Model & Schema](./docs/architecture/data-model.md)** — Entity-Relationship Diagram, Prisma models, migrations.
* **[Role-Based Access Control (RBAC)](./docs/security/rbac.md)** — `authenticate()` and `authorize("ADMIN")`, 401 vs 403.
* **[Authentication & Token Management](./docs/security/authentication.md)** — JWT, refresh token rotation, Argon2 hashing.
* **[Queue Abstraction & Events](./docs/infrastructure/queue.md)** — `QueueService` interface, post-commit `USER_REGISTERED` event.
* **[Redis Integration](./docs/infrastructure/redis.md)** — Connection management, infrastructure verification.
* **[Health Checks & Probes](./docs/infrastructure/health-checks.md)** — Kubernetes Liveness & Readiness monitoring.
* **[API Endpoints & Swagger](./docs/api/endpoints.md)** — Complete endpoint catalog and OpenAPI contracts.
* **[Development & Operations Guide](./docs/operations/development-guide.md)** — Docker setup, seeding admin user, testing.

---

## Architecture Overview

```mermaid
flowchart TD
    Client["Client / Frontend"] --> Ingress["Express Application (App.ts)"]

    subgraph Middleware["Global Middleware Pipeline"]
        Ingress --> ReqId["Request ID Middleware (x-request-id)"]
        ReqId --> ReqLog["Structured Request Logger (Pino)"]
        ReqLog --> BodyParse["JSON / URL-Encoded Parser"]
    end

    subgraph Routing["Route Handlers & Security"]
        BodyParse --> DocsRoute["Swagger UI (/docs, /api-docs)"]
        BodyParse --> HealthRoute["Health Module (/health)"]
        BodyParse --> AuthRoute["Auth Module (/api/v1/auth)"]
        BodyParse --> AdminRoute["Admin Module (/api/v1/admin)"]

        AdminRoute --> AuthMiddleware["authenticate()"]
        AuthMiddleware --> RBACMiddleware["authorize('ADMIN')"]
        RBACMiddleware --> AdminController["Admin Controller"]
    end

    subgraph Infrastructure["Services & Persistence Layer"]
        HealthRoute --> PG_Health["PostgreSQL Connection Probe"]
        HealthRoute --> Redis_Health["Redis Ping Probe"]

        AuthRoute --> AuthService["Auth Service"]
        AuthService --> PrismaRepo["Prisma Client (@prisma/adapter-pg)"]
        PrismaRepo --> PostgresDB[("PostgreSQL 16 DB")]

        AuthService --> QueueAdapter["Queue Service (LocalQueueService)"]
        QueueAdapter --> Logger["Logger / Future SQS Broker"]

        Redis_Health --> RedisInstance[("Redis Cache")]
    end
```

---

## Core Features & Technical Design

### 1. Role-Based Access Control (RBAC)

The security layer enforces a strict distinction between authentication and authorization:
* **401 Unauthorized**: The request lacks a valid token or the token is expired/invalid.
* **403 Forbidden**: The request is authenticated, but the user lacks the required permission/role.

```mermaid
flowchart TD
    Req["Incoming HTTP Request"] --> Auth["authenticate() Middleware"]
    Auth --> HasToken{"Valid Bearer Token?"}
    HasToken -- "No" --> Ret401["Return 401 Unauthorized"]
    HasToken -- "Yes" --> DecodeJWT["Decode JWT & Attach req.user"]

    DecodeJWT --> RBAC["authorize('ADMIN') Middleware"]
    RBAC --> HasUser{"req.user Exists?"}
    HasUser -- "No" --> Ret401RBAC["Return 401 Unauthorized"]
    HasUser -- "Yes" --> CheckRole{"Contains 'ADMIN' Role?"}
    CheckRole -- "No" --> Ret403["Return 403 Forbidden"]
    CheckRole -- "Yes" --> NextHandler["next() -> Allow Handler Execution (200 OK)"]
```

---

### 2. Event-Driven Queue Abstraction (`USER_REGISTERED`)

The queue system uses dependency abstraction (`QueueService` interface) allowing seamless transition from a local logger adapter to cloud queue systems (such as AWS SQS).

**Rule:** Domain events (e.g. `USER_REGISTERED`) are published **only after** the database transaction has committed.

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant AuthController as Auth Controller
    participant AuthService as Auth Service
    participant Repo as Auth Repository
    participant DB as PostgreSQL Transaction
    participant Queue as QueueService (LocalQueueService)

    Client->>AuthController: POST /api/v1/auth/register (email, password)
    AuthController->>AuthService: registerUser(input)
    AuthService->>Repo: findUserByEmail(email)
    Repo-->>AuthService: null (user does not exist)

    AuthService->>Repo: createUser(data)
    Repo->>DB: BEGIN Transaction
    Repo->>DB: INSERT INTO "User" & INSERT INTO "UserRole"
    DB-->>Repo: COMMIT Transaction
    Repo-->>AuthService: user created & committed

    Note over AuthService,Queue: Safe to publish: DB commit verified!
    AuthService->>Queue: publish("USER_REGISTERED", { userId, email })
    Queue-->>AuthService: logged / enqueued

    AuthService-->>AuthController: user details
    AuthController-->>Client: 201 Created
```

---

### 3. Kubernetes-Compliant Health Probes

Two dedicated health probe endpoints ensure proper container lifecycle management:

```mermaid
flowchart TD
    subgraph LivenessProbe["Liveness Probe: GET /health/live"]
        LivenessReq["Kubelet Probe"] --> LiveCheck{"Process Running?"}
        LiveCheck -- "Yes" --> Live200["200 OK (Keep Pod Running)"]
        LiveCheck -- "No / Hangs" --> LiveFail["Kubelet Restarts Pod"]
    end

    subgraph ReadinessProbe["Readiness Probe: GET /health/ready"]
        ReadyReq["Load Balancer / Kubelet"] --> DBCheck{"PostgreSQL Ping (SELECT 1)"}
        DBCheck -- "Success" --> RedisCheck{"Redis Ping (PING -> PONG)"}
        DBCheck -- "Failure" --> ReadyFail["503 Service Unavailable"]
        RedisCheck -- "Failure" --> ReadyFail
        RedisCheck -- "Success" --> Ready200["200 OK (Send Traffic to Pod)"]
        ReadyFail --> LBStop["Stop Routing Traffic to Instance"]
    end
```

---

### 4. Database Schema (Prisma)

```mermaid
erDiagram
    User ||--o{ UserRole : "has"
    Role ||--o{ UserRole : "assigned_to"
    User ||--o{ RefreshToken : "owns"

    User {
        string id PK
        string email UK
        string passwordHash
        enum status "ACTIVE | DISABLED"
        datetime createdAt
        datetime updatedAt
    }

    Role {
        string id PK
        string name UK "USER | ADMIN"
    }

    UserRole {
        string userId PK, FK
        string roleId PK, FK
    }

    RefreshToken {
        string id PK
        string userId FK
        string tokenHash
        datetime expiresAt
        datetime revokedAt
        datetime createdAt
    }
```

---

## API Endpoints Reference

| Method | Endpoint | Auth Required | Role | Description |
| :--- | :--- | :---: | :---: | :--- |
| `GET` | `/` | No | - | Root greeting check |
| `GET` | `/docs` | No | - | Interactive Swagger UI |
| `GET` | `/docs/json` | No | - | Raw OpenAPI 3.0 specification |
| `GET` | `/health/live` | No | - | **Liveness Probe**: returns 200 if process is alive |
| `GET` | `/health/ready` | No | - | **Readiness Probe**: returns 200 if DB & Redis are reachable, 503 if down |
| `POST` | `/api/v1/auth/register` | No | - | Register user, assign `USER` role, emit `USER_REGISTERED` |
| `POST` | `/api/v1/auth/login` | No | - | Authenticate with email/password, issues JWT |
| `POST` | `/api/v1/auth/refresh` | No | - | Rotates refresh token & issues new access token |
| `POST` | `/api/v1/auth/logout` | No | - | Revokes refresh tokens |
| `GET` | `/api/v1/admin/health` | **Yes** | `ADMIN` | Protected admin health check (403 for non-admin) |

---

## Getting Started

### 1. Prerequisites
* **Node.js** v20+
* **Docker & Docker Compose**

### 2. Environment Configuration
Create a `.env` file in the root directory:

```env
PORT=3000
NODE_ENV=development

# PostgreSQL (matching docker-compose.yml)
DATABASE_URL=postgresql://postgres:mysecretpassword@127.0.0.1:5433/my_database

# Redis (matching docker-compose.yml)
REDIS_URL=redis://localhost:6379

# Auth
JWT_SECRET=your-super-secret-jwt-key-with-sufficient-length
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
```

### 3. Start Infrastructure Services

```bash
docker compose up -d            # start PostgreSQL and Redis in background
docker compose ps               # verify containers are running
```

Useful Docker maintenance commands:
```bash
docker compose logs -f db       # stream database logs
docker compose exec db psql -U postgres -d my_database   # open postgres shell
docker compose exec cache redis-cli                      # open redis CLI
docker compose down             # stop containers (volumes preserved)
```

### 4. Database Migration & Prisma Setup

Prisma 7 uses a driver adapter (`@prisma/adapter-pg`) with database configuration defined in `prisma.config.ts`:

```bash
npx prisma migrate dev --name init    # apply database migrations
npx prisma generate                  # generate Prisma Client
```

### 5. Seed Test Admin User

Create or update the test administrator account:

```bash
npm run seed:admin
```

**Default Test Credentials:**
* **Email:** `admin@example.com`
* **Password:** `AdminPassword123!`
* **Role:** `ADMIN`

---

## Running the Application

### Development Mode
```bash
npm run dev
```
The server will start at `http://localhost:3000`.

### Running Integration Tests
All tests are implemented using the native test runner and TypeScript execution (`tsx --test`):

```bash
npm test
```

Test suites cover:
* **RBAC & Admin Route (`src/tests/rbac-admin.test.ts`)**: 401 unauthenticated, 403 user forbidden, 200 admin allowed.
* **Queue Abstraction (`src/tests/queue.test.ts`)**: Local queue adapter contract and `USER_REGISTERED` publishing post-commit.
* **Redis Connection (`src/tests/redis.test.ts`)**: `SET health:redis ok` & `GET health:redis`.
* **Health Checks (`src/tests/health.test.ts`)**: Liveness 200, Readiness 200 (healthy) & 503 (degraded).
* **Swagger Documentation (`src/tests/swagger.test.ts`)**: OpenAPI schema and UI route availability.

---

## Project Structure

```text
├── docker-compose.yml           # PostgreSQL & Redis container configuration
├── prisma/
│   ├── schema.prisma            # Database models & relationships
│   └── migrations/              # SQL schema migration history
├── prisma.config.ts             # Prisma 7 adapter configuration
├── scripts/
│   ├── seed-admin.ts            # Admin user database seed script
│   └── test-api.ts              # API smoke test script
├── src/
│   ├── app.ts                   # Express application setup & middleware wiring
│   ├── server.ts                # HTTP server bootstrap
│   ├── config/
│   │   ├── env.ts               # Zod-validated environment schema
│   │   ├── prisma.ts            # PrismaClient instance with PG adapter
│   │   └── redis.ts             # Redis connection manager & health checks
│   ├── common/
│   │   ├── logger.ts            # Pino structured JSON logger
│   │   ├── token.ts             # JWT signing and verification
│   │   └── queue/               # QueueService interface & LocalQueueService
│   ├── errors/
│   │   └── AppError.ts          # Operational error classes (400, 401, 403, 404, 409)
│   ├── middlewares/
│   │   ├── auth.ts              # authenticate() & authorize() RBAC middleware
│   │   ├── rbac.ts              # RBAC re-export
│   │   ├── requestId.ts         # Adds UUID x-request-id to requests & responses
│   │   └── requestLogger.ts     # Logs inbound requests & status codes
│   ├── docs/
│   │   ├── swagger.ts           # Swagger UI router & OpenAPI definitions
│   │   └── swagger.json         # OpenAPI 3.0 specification file
│   ├── modules/
│   │   ├── admin/               # Admin routes & controllers (GET /api/v1/admin/health)
│   │   ├── auth/                # Auth routes, controllers, services, repositories
│   │   ├── health/              # Liveness and Readiness probes (/health/live, /health/ready)
│   │   └── user/                # User profile endpoints
│   └── tests/                   # Integration & contract test suites
└── tsconfig.json
```