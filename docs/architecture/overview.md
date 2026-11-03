# Architecture overview

## Responsibility layers

HTTP requests pass through security headers, CORS, cookie parsing, correlation ID, request logging, raw Stripe body parser where applicable, bounded JSON parser and the routed controller. Domain services enforce business rules. Prisma repositories own DB access; Redis is a cache, not the source of truth. Workers are independently started. The code is **modular layered architecture**, not isolated microservices.

```mermaid
flowchart TD
    Client["Client / Postman"] --> Express["Express 5 API"]
    Express --> Guards["JWT + DB status/RBAC + Zod validation"]
    Guards --> Controllers["Controllers"]
    Controllers --> Services["Auth / Products / Orders / Payment services"]
    Services --> Repos["Prisma repositories"]
    Repos --> PG[("PostgreSQL")]
    Services --> Cache[("Redis cache")]
    Repos --> Outbox[("OutboxEvent rows")]
    Outbox --> Poller["Outbox poller (worker process)"]
    Poller --> BullMQ["BullMQ in Redis"]
    BullMQ --> Worker["Email worker"]
    Worker --> Sim["Simulated log OR configured email HTTP adapter"]
    Services --> Stripe["Stripe Checkout API"]
    Stripe --> Signed["Signed raw-body webhook"]
    Signed --> Services
    Google["Google OAuth + JWKS"] --> Guards
```

## Creation/reservation transaction

```mermaid
sequenceDiagram
    participant U as Authenticated user
    participant A as Orders API
    participant DB as PostgreSQL
    participant W as Worker
    U->>A: POST /api/v1/orders {items}
    A->>DB: BEGIN
    loop For each item
      A->>DB: Conditional UPDATE inventory (available >= quantity)
      DB-->>A: affected row count
    end
    A->>DB: Create order + price snapshots + outbox event
    A->>DB: COMMIT
    A-->>U: Pending order
    W->>DB: Read unpublished outbox rows
    W->>W: Add job to BullMQ; mark outbox published
```

## Checkout and signed webhook

```mermaid
sequenceDiagram
    participant User
    participant API
    participant Stripe
    participant DB as PostgreSQL
    participant Worker
    User->>API: POST /orders/:id/checkout
    API->>DB: Check order owner, status, expiry
    API->>Stripe: Create card-only Checkout (idempotency key)
    Stripe-->>API: session id and url
    API->>DB: Store bound pending payment
    API-->>User: Checkout URL
    User->>Stripe: Pay by card
    Stripe->>API: checkout.session.completed + signature
    API->>API: Verify raw-body signature + payment_status paid
    API->>DB: BEGIN + unique provider event insert
    API->>DB: Verify session, amount, currency, order state
    API->>DB: Conditional PAID transition + decrement reserved inventory
    API->>DB: Update payment + insert outbox event + COMMIT
    API-->>Stripe: 200 acknowledgment
    Worker->>DB: Deliver committed outbox to BullMQ
```

### State guarantees and limitations

- Pending order creation and stock reservation are atomic in PostgreSQL.
- Checkout uses server-side price snapshots and single-purpose card payment flow.
- Webhook event uniqueness and a conditional order transition prevent duplicate inventory finalization.
- A genuine paid event for a **cancelled/expired** order fails with a reconciliation-required conflict, rather than silently restocking/confirming. Such cases require operations support.
- Cancellation is rejected after a Checkout has begun, until the external payment state can be reconciled.
- The outbox protects against losing the **enqueue request** when the API commits but Redis is offline. It does not itself guarantee exactly-once email delivery.
- Redis failures should not invalidate PostgreSQL reads/writes where cache use is optional.

### Directory guide

- `src/modules/auth`: identity, session rotation, Google flow
- `src/modules/products`: Zod input, product CRUD, cache use
- `src/modules/orders`: stock reservation, order access/cancellation
- `src/modules/payments`: Checkout and webhook event processing
- `src/common/cache`: cache-aside and invalidation
- `src/common/queue`: BullMQ adapter and outbox poller
- `src/workers/email.worker.ts`: queued email simulation or configured HTTP transport
- `src/middlewares`: auth, RBAC, request ID, logger, rate limiting
