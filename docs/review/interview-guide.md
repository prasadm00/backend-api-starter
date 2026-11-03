# Portfolio project review — interview explanations

Use only claims that you have **personally verified by running the service**. Code source alone is not evidence of deployment, provider payment confirmation or production-scale performance.

## 90-second explanation

"I built a modular e-commerce backend with Node.js, TypeScript, Express, Prisma and PostgreSQL. Customers authenticate using signed access tokens and cookie-based rotating refresh sessions. Admins maintain products while customers create orders. Order creation conditionally reserves available inventory inside a transaction, avoiding the classic final-item oversell. Stripe Checkout handles hosted card payment, but the server trusts only a signed webhook tied to the stored session, amount and currency. The same transaction finalizes order status and creates a notification outbox event, and a separate BullMQ worker publishes email jobs. Redis caches product reads. I documented tradeoffs, failure handling and automated tests, and prepared the API and worker for container deployment."

Only say "fully tested" or "deployed to AWS" after you actually complete those checks.

## Three-minute walkthrough

Use this sequence: (1) system and why PostgreSQL/Prisma, (2) authentication + JWT freshness, (3) products and cache-aside invalidation, (4) last-stock conditional update and transactional order creation, (5) Stripe signature-bound webhook and uniqueness, (6) Postgres outbox + BullMQ + retry semantics, (7) operations, integration testing, deployment status and remaining limitations.

## Questions to rehearse

1. What happens if two requests buy the final stock unit?
2. How is your cancellation protected against double inventory release?
3. Why store `OrderItem.unitPrice` rather than referencing the current product price?
4. Why does the payment-success browser redirect NOT prove payment?
5. Can a fabricated `checkout.session.completed` body mark an order paid?
6. How do you prevent the same provider event from decrementing reserved stock twice?
7. Why reject paid events for cancelled/expired orders instead of confirming them automatically?
8. What happens if PostgreSQL commits a new order but Redis is down?
9. Does BullMQ plus the outbox guarantee exactly-once email delivery?
10. How is Google `sub` verified? Why isn't matching email enough to link accounts?
11. What happens to JWT roles if an admin revokes a permission?
12. Why store a hash of an opaque refresh token instead of the raw token?
13. What does `EXPLAIN` tell you about the order-history index?
14. Why deploy the API and worker as separate processes?
15. Which parts are still unverified and what would you test next?

## Resume bullets — use only after corresponding tests pass

- Designed a modular Node.js/TypeScript backend using Express and Prisma/PostgreSQL, with JWT authentication, refresh-session rotation, RBAC and relational order/product models.
- Implemented transactional inventory reservations and idempotent Stripe webhook state transitions, protecting stock from concurrent purchases and duplicate payment events.
- Built Redis cache-aside access and a PostgreSQL outbox → BullMQ worker pipeline for retryable notification jobs; added container/CI scaffolding and failure-handling documentation.

Do **not** invent p95 latency, throughput, cloud uptime, percentage improvements or actual email delivery before measuring/implementing them.
