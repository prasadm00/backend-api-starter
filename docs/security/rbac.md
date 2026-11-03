# RBAC and resource ownership

The existing roles remain **USER** and **ADMIN**. Role mappings are stored in `Role` + `UserRole`. JWTs are used for authentication, but every protected request also looks up the current user status and roles from PostgreSQL so disable/role changes take effect immediately.

| Endpoint | Access |
|---|---|
| `/health/*`, `/docs/*`, `GET /products` and `GET /products/:id` | Public |
| `/api/v1/admin/health` | ADMIN |
| POST/PATCH `/api/v1/products` | ADMIN |
| `/api/v1/orders` create/list | Active authenticated user |
| `/api/v1/orders/:id` read/cancel | Order owner or ADMIN |
| `/api/v1/orders/:id/checkout` | Order owner only |
| `/api/v1/orders/:id/payment` | Order owner or ADMIN |
| `GET /api/v1/auth/google/link` | Active authenticated user |

`authenticate` returns 401 when JWT is missing/invalid/expired or the user is disabled. `authorize('ADMIN')` returns 403 for authenticated users without a required role. Object-level ownership checks are separate from role checks; a USER must not get another user's order by changing its UUID.

**Do not trust:** user IDs in request bodies, `roles` directly from JWT for current authorization, or an email match as proof of account ownership.
