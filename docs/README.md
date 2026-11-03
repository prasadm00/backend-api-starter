# Technical documentation index

The documentation below reflects the modified **E-commerce Backend API**, including actual code modules and explicitly labeled limitations.

| Area | Document |
|---|---|
| Project state | [Implementation status](../IMPLEMENTATION_STATUS.md) |
| Architecture | [Overview & sequence diagrams](architecture/overview.md) |
| Data | [Prisma models and transaction rules](architecture/data-model.md) |
| Decisions | [Tradeoffs and alternatives](architecture/decisions.md) |
| API | [Routes, authorization & sample calls](api/endpoints.md) |
| Security | [Auth, refresh, Google OIDC](security/authentication.md) |
| Authorization | [RBAC & ownership checks](security/rbac.md) |
| Messaging | [Transactional outbox, BullMQ, email](infrastructure/queue.md) |
| Cache | [Redis access, invalidation, fallbacks](infrastructure/redis.md) |
| Health | [Liveness/readiness](infrastructure/health-checks.md) |
| Local ops | [Development guide](operations/development-guide.md) |
| Failure handling | [Failure scenarios](operations/failure-scenarios.md) |
| AWS | [Deployment runbook (not executed)](operations/aws-deployment.md) |
| Interviews | [Project walkthrough & honest resume claims](review/interview-guide.md) |
