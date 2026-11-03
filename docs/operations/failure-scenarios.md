# Failure scenarios and response plan

| Failure | Current behavior | Required operational follow-up |
|---|---|---|
| PostgreSQL unavailable | Transaction fails; readiness 503; API responds with sanitized error | Restore DB connectivity, inspect migrations/pool, retry only idempotent requests |
| Redis cache unavailable | Cache reads degrade to PostgreSQL; invalidation may fail | Inspect Redis health; stale product cache TTL bounded but monitor mismatches |
| Redis queue unavailable | PostgreSQL transaction commits its event to OutboxEvent; poller retries enqueue | Alert on oldest unpublished event and Redis reconnection |
| Email provider fails | BullMQ retries (exponential backoff, 4 attempts) and logs failure | Dead-letter/manual retry and provider-specific idempotency need integration |
| API crashes after DB commit | Outbox row remains and can be enqueued after restart | Run at least one healthy worker; monitor outbox age |
| Worker crashes after sending but before acknowledgement | Job may be reprocessed | Provider idempotency key must be enforced to avoid duplicate emails |
| Duplicate Stripe webhook | Unique providerEventId and guarded order status prevent double finalization | Verify webhook 200 response and one stock decrement |
| Forged/unsigned Stripe webhook | Signature verification rejects (401) | Monitor repeated signature failures; never enable mock bypass |
| Stripe paid event for expired/cancelled order | Payment finalization fails with conflict, requires investigation | Reconcile provider state, refund/re-reserve as policy requires; do not silently confirm |
| Checkout started but no payment received | Direct cancellation blocked to prevent paid-after-restock race | Manually expire Checkout, reconcile provider payment status and release stock in a controlled DB transaction |
| Google OAuth callback replay/missing state | Signed cookie + state validation fails | Start a new authorization flow |
| Disabled account with old access JWT | Middleware reloads user state and denies access | Revoke outstanding refresh sessions as policy requires |
| JWT signing secret rotation | Existing JWTs become invalid unless using planned key rotation | Use staged version/key ID rollout and controlled session management |
| Multi-instance auth brute force | Local rate limiter doesn't share state | Use gateway/WAF or shared Redis limiter before production |

## Recommended alerts

- P95 API latency and 5xx error rate above baseline.
- Outbox oldest unpublished age > a few minutes / queue backlog rising.
- Worker failed-job count or consecutive webhook signature failures rising.
- PostgreSQL connection errors and Redis availability checks.

## Recovery rules

Only retry an operation when it is designed to be idempotent or has a verified unique request key. Never rerun a debit, order reservation or email send blindly. Use database transactions for durable state changes, provider webhooks for payment confirmation and manual reconciliation for ambiguous paid-but-unfinalized situations.
