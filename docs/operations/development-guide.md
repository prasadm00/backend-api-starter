# Local development guide

## Setup

1. Install Node.js 22, npm and Docker Engine/Compose.
2. Copy `.env.example` to `.env`, replace `JWT_SECRET` with a fresh long random value, and provide DB/Redis URLs.
3. `docker compose up -d db cache` (host ports 5433 and 6379).
4. `npm ci && npx prisma generate && npx prisma migrate deploy`.
5. `npm run typecheck && npm run build && npm test`.
6. Start API (`npm run dev`) and worker (`npm run worker`) in separate terminals.
7. Check `/health/live`, `/health/ready`, and `/docs/json`.

`npm test` runs integration tests and needs its **own isolated database** migrated to the latest schema, not production. CI supplies ephemeral Postgres/Redis containers.

## Admin provisioning

The seed script requires explicit nondefault admin credentials. Example:

```bash
ADMIN_EMAIL='your-admin@example.com' ADMIN_PASSWORD='YOUR_UNIQUE_LONG_PASSWORD' npm run seed:admin
```

Never use real administrator credentials in committed scripts, shell history or archives. The script does not print the password.

## Optional providers

**Stripe:** create a Stripe test-mode API key and configure `STRIPE_SECRET_KEY`. Use Stripe CLI/test dashboard to obtain a webhook secret for `/api/v1/webhooks/stripe`; configure `STRIPE_WEBHOOK_SECRET`. Checkout URLs must use a deployed/accessible `PUBLIC_BASE_URL` for redirects. A Checkout success redirect alone is not payment confirmation.

**Google:** create an OAuth web client. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and exact `GOOGLE_CALLBACK_URL` (`http://localhost:3000/api/v1/auth/google/callback` for local testing). Start at `GET /auth/google` in a browser session that retains the flow cookie, then navigate to its returned URL. Login callback verifies state, PKCE, nonce and Google's signed ID token.

**Email:** `EMAIL_TRANSPORT=log` does not send email. A real HTTP adapter can be configured using `EMAIL_TRANSPORT=webhook`, `EMAIL_API_URL`, `EMAIL_API_KEY`. Verify the provider accepts `{to,subject,text}` and an `Idempotency-Key` header; otherwise implement your provider's actual integration before using it.

## Docker Compose: API + worker

```bash
docker compose up -d --build db cache
docker compose run --rm api npm run db:deploy
docker compose up -d --build api worker
docker compose logs -f api worker
```

Compose database/Redis addresses are service names `db`/`cache`, not localhost. Production must use managed/private services, secure credentials and IAM roles. These commands were not executed inside this artifact environment because Docker and npm registry access were not available.

## Tests and build

`npm run typecheck`, `npm run build`, `npm test`. Build is NodeNext ESM; `.js` specifiers appear in TypeScript imports by design so emitted JS resolves under Node. `npm start` runs the compiled API and `npm run worker:prod` the compiled worker.

## Working branch and safety

Extract the updated ZIP to a fresh directory, compare changes with your own working tree, **do not blindly overwrite work committed since the ZIP snapshot**, review Prisma migrations, and run checks before merging. Neither `.env` nor `.git` is included in the updated ZIP.
