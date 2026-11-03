# Architecture decisions and tradeoffs

| Choice | Rationale | Tradeoff / alternative |
|---|---|---|
| PostgreSQL + Prisma | Relational orders, inventory transactions, FK/unique constraints and migrations | Prisma hides some SQL; inspect generated queries and EXPLAIN for performance-sensitive paths |
| Decimal `Product.price` + `OrderItem.unitPrice` | Preserve exact currency values and purchase-time price snapshots | Explicit currency minor-unit conversion is needed for payments |
| Redis cache-aside | Lower product read load; expiry/invalidation after mutation | Stale windows and Redis outages remain; PostgreSQL is always authoritative |
| BullMQ + Redis | Reliable queue and configurable retries / worker concurrency | Requires separate Redis service; not identical to an actual email provider |
| PostgreSQL transactional outbox | Guarantees pending publish record commits with business data | At-least-once delivery, duplicate-safe downstream processing required |
| Short-lived JWT + hashed opaque refresh token | Efficient access validation, revocable sessions with atomic rotation | DB lookup for current role/status adds cost but avoids stale admin access |
| Cookie-only refresh transport | Protects long-lived bearer tokens from client-side JS; supports rotation/revocation | Requires trusted-origin/CSRF-aware browser design |
| Google OIDC with code flow + PKCE/state/nonce | Verified identity and explicit account-linking, no spoofable `googleSub` | Needs real Google client and network, not exercised offline |
| Stripe hosted Checkout | Avoid handling payment card data; signed, bound webhook is source of truth | Payment reconciliation/refunds and abandoned session cleanup are additional operational work |
| Separate API + worker containers | Independently scale/restart request handling and background jobs | More deployment/monitoring surfaces |
| NodeNext ESM build | `tsc` emits directly runnable JS with explicit `.js` import specifiers | Imports in TS must use `.js` specifiers; tests run with tsx |

## Design boundaries

This is a **modular monolith**, not microservices. It does not implement service discovery, cross-service distributed transactions, subscriptions, production email or autonomous payment reconciliation. Do not call it production-ready until real deployment, disaster recovery, secret rotation, alerts, backups and end-to-end tests have been exercised.
