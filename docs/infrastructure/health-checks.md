# Liveness and readiness

- `GET /health/live` returns uptime and process status without external dependency checks.
- `GET /health/ready` checks PostgreSQL and Redis connectivity, and returns 200 only when both succeed. On failure it returns 503 and **generic** dependency error messages; sensitive connection internals stay in server logs.
- Currently Redis is counted as a required readiness dependency because BullMQ/outbox processing is central to full application functionality, even though cached product reads degrade to PostgreSQL when Redis is unavailable. Decide readiness semantics based on deployment SLOs.
- Recommended CloudWatch metrics: HTTP error rate, p95 API latency, DB pool usage, Redis availability, BullMQ backlog and failed jobs, webhook signature failures, unpublished outbox age.
