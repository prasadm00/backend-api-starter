# Redis caching and queue storage

Redis hosts two separate concerns: cache-aside **read optimization** and BullMQ job data. It is not a substitute for durable business records in PostgreSQL.

- `CacheService.get/set/del/delPattern` in `src/common/cache/cache.service.ts` caches product detail and listing results for short TTLs (60s and 30s).
- Product admin mutations, order stock reservations and order cancellation invalidate relevant product cache entries and list keys.
- Wildcard invalidation uses incremental `SCAN` instead of Redis-blocking `KEYS`.
- Cache GET/SET failures log the error and fall back to PostgreSQL/continue the committed write.
- Avoid caching sensitive tokens, passwords or private order details.
- Redis connection attempts are bounded by short timeouts/backoff to avoid hanging routine product reads indefinitely.
- BullMQ enqueue errors are **not** disguised as successful jobs. Outbox entries remain pending until a publish succeeds.

**Known limitation:** Cache invalidation isn't fully atomic with PostgreSQL commit. A brief stale-read window remains possible, so order stock eligibility is always checked transactionally in the DB.
