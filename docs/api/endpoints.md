# REST API catalog

**Base URL:** `http://localhost:3000/api/v1`. The repository also mounts `/v1` aliases; treat `/api/v1` as canonical. Interactive OpenAPI: `/docs/`. Machine-readable spec: `/docs/json`. Request IDs returned as `x-request-id`.

| Method | Path | Required permission | Notes |
|---|---|---|---|
| GET | `/health/live`, `/health/ready` | Public | Process & dependency health (not under API prefix) |
| POST | `/auth/register` | Public | Email/password registration |
| POST | `/auth/login` | Public | Access JWT JSON + HttpOnly refresh cookie |
| POST | `/auth/refresh` | Refresh cookie | Atomically rotate refresh, return access JWT |
| POST | `/auth/logout` | Refresh cookie optional | Revoke presented refresh session |
| GET | `/auth/me` or `/users/me` | Bearer JWT | Active current profile |
| GET | `/auth/google` | Public | Authorization URL + signed flow cookie |
| GET | `/auth/google/callback` | OAuth flow cookie and code/state | Verify Google identity and sign in/link |
| GET | `/auth/google/link` | Bearer JWT | Start explicit linking flow |
| GET | `/admin/health` | ADMIN bearer JWT | RBAC check |
| GET | `/products` | Public | `page`, `limit`, `status`, `search`, `sortBy`, `sortOrder` |
| GET | `/products/:id` | Public | Product detail + inventory |
| POST | `/products` | ADMIN bearer JWT | Create product + inventory |
| PATCH | `/products/:id` | ADMIN bearer JWT | Update fields and available stock |
| PATCH | `/products/:id/status` | ADMIN bearer JWT | Activate/deactivate |
| POST | `/orders` | Bearer JWT | Reserve stock, create pending order |
| GET | `/orders` | Bearer JWT | Own order list, `page`, `limit`, `status` |
| GET | `/orders/:id` | Order owner or ADMIN | Details and history |
| POST | `/orders/:id/cancel` | Owner or ADMIN | Only before any Stripe Checkout is initiated |
| POST | `/orders/:id/checkout` | Order owner | Create Stripe test Checkout session |
| GET | `/orders/:id/payment` | Owner or ADMIN | Database payment state; redirects never prove payment |
| POST | `/webhooks/stripe` | Valid Stripe signature | Raw JSON body, idempotent event processing |

### Requests (replace placeholders)

Register:

```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"customer@example.com","password":"BetterPassword123!"}'
```

Login and save HttpOnly cookie for refresh:

```bash
curl -c cookies.txt -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"customer@example.com","password":"BetterPassword123!"}'
# Copy the accessToken from the returned JSON into the next commands.
curl -b cookies.txt -c cookies.txt -X POST http://localhost:3000/api/v1/auth/refresh
```

Create a product (ADMIN token):

```bash
curl -X POST http://localhost:3000/api/v1/products \
  -H "Authorization: Bearer YOUR_ADMIN_ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"USB Keyboard","description":"Example product","price":25.99,"currency":"USD","stock":3}'
```

Reserve inventory for an order:

```bash
curl -X POST http://localhost:3000/api/v1/orders \
  -H "Authorization: Bearer YOUR_CUSTOMER_ACCESS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"items":[{"productId":"PRODUCT_UUID","quantity":1}]}'
```

Create Stripe test Checkout for resulting order:

```bash
curl -X POST http://localhost:3000/api/v1/orders/ORDER_UUID/checkout \
  -H "Authorization: Bearer YOUR_CUSTOMER_ACCESS_TOKEN"
```

**Stripe webhook:** configure the URL and real webhook secret using Stripe CLI/test dashboard. Do **not** replay unsigned JSON; the endpoint intentionally rejects it. Google callback likewise requires a real Google authorization code and signed state cookie.

## Response and errors

Success shapes are module-specific (`{ status:'success', data }` or `{ message, data }`); errors consistently include `{ "code": "...", "message": "..." }` with optional safe validation details. Typical codes: 400 input problem; 401 no/invalid auth; 403 insufficient access; 404 missing resource; 409 conflict/stock/payment-state race; 422 schema validation; 429 auth rate limit; 503 provider not configured or dependency unavailable.

## Data and security caveats

- Product price is server-derived, stored as a Prisma Decimal snapshot in order items. Do not send your own payment total in checkout requests.
- `POST /orders` rejects duplicated product IDs, mixed currencies and unavailable inventory; its stock updates are conditional.
- A checkout session is only valid within the active order reservation. Once Checkout is initiated, direct cancellation is intentionally blocked pending external reconciliation.
- Google login and linking require verified OIDC claims; no mock/test identity bypass exists.
- Refresh tokens are cookie-only; do not send a `refreshToken` JSON body.
- **No actual email is sent in default `EMAIL_TRANSPORT=log` mode.**
