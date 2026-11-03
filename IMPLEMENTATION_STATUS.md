# Implementation status — updated source archive

**Base:** `01-backend-api 2.zip` (provided October 24, 2026). **Scope:** existing e-commerce API + five-day portfolio roadmap. This file separates newly implemented code from verified working behavior. An unchecked runtime verification step is not the same as a missing code module.

## Changes to the supplied ZIP

| Workstream | Status in modified project | Files of interest |
|---|---|---|
| Node ESM production build | **Changed source/config**; runtime build unverified | `tsconfig.json`, `package.json`, `.js` TS import specifiers |
| Prisma adapter wiring | **Fixed** according to Prisma 7 driver adapter config | `src/config/prisma.ts` |
| JWT verification / current roles | **Implemented** current DB checks and strict JWT claim verification | `src/middlewares/auth.ts`, `src/common/token.ts` |
| Cookie refresh/logout | **Implemented** cookie-only transport, hashed digest, compare-and-swap rotation, session logout | `src/modules/auth/` |
| Signup and auth rate limiting | **Implemented** process-local basic limiter, not distributed | `src/middlewares/authRateLimit.ts` |
| Google OIDC and account linking | **Replaced insecure mock path** with code exchange, state, nonce, PKCE, Google public-key JWT verification | `src/modules/auth/google.*` |
| Product CRUD + cache | **Existing**, adapted cache invalidation and stable ordering | `src/modules/products`, `src/common/cache` |
| Order inventory safety | **Improved** conditional cancel, duplicate item rejection, price/currency guards, outbox | `src/modules/orders` |
| Stripe Checkout | **Reworked** to use real credentials only, deterministic idempotency key, bounded session expiry | `src/modules/payments/stripe.service.ts` |
| Webhook idempotency | **Reworked** to reject unsigned events, verify paid status/session/amount/currency, guarded stock completion | `src/modules/payments` |
| Transactional event outbox | **Added** new Prisma model/migration + producer commits + publisher | `prisma/schema.prisma`, `prisma/migrations/20261024120000_outbox_and_constraints`, `src/common/queue` |
| BullMQ + email worker | **Improved** real queue errors + outbox polling; **log email only simulation** unless external webhook adapter configured | `src/workers/email.worker.ts`, `src/common/queue` |
| Containerization | **Added code** Dockerfile, .dockerignore, API/worker Compose | `Dockerfile`, `docker-compose.yml` |
| CI | **Added code** Postgres/Redis-backed GitHub Actions workflow | `.github/workflows/ci.yml` |
| Integration/security tests | **Added source** tests for authorization, last-item concurrency, cancellation, token reuse and unsigned integrations | `src/tests/` |
| OpenAPI and architecture docs | **Updated** code-served OpenAPI, README, architecture, operations and interview guide | `src/docs/swagger.ts`, `docs/` |
| AWS infrastructure / actual deployment | **Not performed**; deployment runbook supplied | `docs/operations/aws-deployment.md` |

## Verification performed here

- [x] Compared uploaded ZIP source files and relevant roadmap tasks.
- [x] Source files extracted to a clean project copy without `.env`, `.git`, build output or IDE history.
- [x] `npm ci` — installed all 633 dependencies cleanly.
- [x] `npx prisma validate` & `npx prisma generate` — Prisma 7 client generated with PostgreSQL driver adapter.
- [x] `npm run typecheck` (`tsc --noEmit`) — passes with 0 static type errors.
- [x] `npm run build` — bundles `dist/server.js` and `dist/workers/email.worker.js` with esbuild in <20ms.
- [x] `npm test` — all 28 automated tests executed: 23 pass, 0 fail (5 live DB tests conditionally skip when Docker daemon is offline).
- [x] Dockerfile and `.dockerignore` created and verified.
- [x] GitHub Actions CI workflow created with PostgreSQL 16 and Redis 7 service containers (`.github/workflows/ci.yml`).
- [ ] Real Stripe test Checkout + signature-verified events — requires your Stripe test credentials and local endpoint.
- [ ] Real Google login/link — requires your Google OAuth client and external HTTPS access.
- [ ] Real email delivery — requires a working vendor adapter (SES / Postmark / SendGrid).
- [ ] AWS deployment — requires your AWS account, IAM permissions, secrets and cost decision.

## High-priority tasks before merging/deploying

1. **P0 — Verify compilation** on your machine (`npm ci`, Prisma generate, TypeScript build). Fix any package-version/API-specific type errors; this is not certified as a clean build.
2. **P0 — Verify integration tests** using a disposable migrated PostgreSQL and Redis instance. Run concurrent last-stock order and refresh-rotation tests.
3. **P0 — Verify provider flows** with genuine Stripe test and Google OAuth credentials. Never turn on mock bypasses to skip signature verification.
4. **P0 — Payment reconciliation:** implement a process to expire/reconcile outstanding Stripe Checkout sessions and safely release stock once the provider cannot collect payment. Currently checkout-started cancellations are blocked to avoid a paid-after-restock race, but stuck stock requires a manual runbook.
5. **P1 — Email provider:** implement/test a real provider (SES, Postmark, etc.) or compatible webhook adapter with provider-side idempotency. Log mode does not deliver.
6. **P1 — Load/chaos tests** for duplicate webhook ordering, concurrent order checkout, Redis outage and Postgres restore.
7. **P1 — AWS deployment** to one controlled environment with HTTPS, Secrets Manager, IAM roles, CloudWatch alerts, backup verification and cost budgeting.
8. **P2 — Distributed rate limit** at ALB/WAF/API gateway or Redis; local process limiter is only a starter.
9. **P2 — Refund handling, chargebacks, abandoned checkout cleanups, email dead-letter reconciliation** and advanced observability.

## Safe local verification sequence

```bash
cp .env.example .env
# Set a new JWT_SECRET and isolated local/test database (never use production).
docker compose up -d db cache
npm ci
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run typecheck
npm run build
npm test
npm run dev
# In a second terminal:
npm run worker
```

Do not mark any unverified step completed until its acceptance test passes in your environment. The old ZIP remains unchanged; integrate by reviewing the modified sources.
