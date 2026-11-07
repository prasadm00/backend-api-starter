import { Router } from "express";
import swaggerUi from "swagger-ui-express";

// ---------------------------------------------------------------------------
// Small helpers to keep the path definitions readable
// ---------------------------------------------------------------------------
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object) => ({ "application/json": { schema } });
const ok = (description: string, schemaName?: string) => ({
  description,
  ...(schemaName ? { content: json(ref(schemaName)) } : {}),
});
const err = (description: string) => ({
  description,
  content: json(ref("ErrorResponse")),
});
const idParam = (description = "Resource ID (UUID)") => ({
  name: "id",
  in: "path",
  required: true,
  description,
  schema: { type: "string", format: "uuid" },
});

// Reusable error responses (same shape everywhere: ErrorResponse)
const E400 = err("Bad Request");
const E401 = err("Unauthorized: missing, invalid or expired token");
const E403 = err("Forbidden: not the owner, or ADMIN role required");
const E404 = err("Not Found");
const E409 = err("Conflict");
const E422 = err("Validation failed (see `errors` for field details)");
const E429 = err("Too many requests (rate limited)");
const E503 = err("Service unavailable / not configured");

const bearer = [{ BearerAuth: [] }];

export const swaggerDocument = {
  openapi: "3.0.0",
  info: {
    title: "Backend API Documentation",
    version: "1.0.0",
    description: [
      "E-commerce backend REST API: secure auth, Product/Order management, Stripe Checkout and webhook, Google OIDC, Redis caching and a transactional outbox.",
      "",
      "**Base paths:** every route is available under both `/api/v1/...` and `/v1/...`. This document lists the `/api/v1` form.",
      "",
      "**Authentication:** call `POST /api/v1/auth/login`, copy `data.accessToken`, then click **Authorize** and paste it. Roles (`USER`, `ADMIN`) are read from the database on each request.",
      "",
      "**Typical purchase flow:** `POST /orders` (reserves stock for 60 min) -> `POST /orders/{id}/checkout` (needs > 31 min of reservation left) -> pay on the Stripe page -> Stripe calls `POST /webhooks/stripe` -> poll `GET /orders/{id}/payment`.",
      "",
      "**Errors:** all errors use the `ErrorResponse` shape. Validation failures return `422`.",
    ].join("\n"),
  },
  servers: [
    {
      url: "http://localhost:3000",
      description: "Local development server",
    },
  ],
  tags: [
    { name: "Health", description: "Liveness and readiness probes" },
    { name: "Auth", description: "Registration, login, token refresh, logout" },
    {
      name: "Google OAuth",
      description: "Sign in with / link a Google account (PKCE)",
    },
    { name: "Users", description: "Current user profile" },
    { name: "Admin", description: "ADMIN-only endpoints" },
    {
      name: "Products",
      description: "Catalogue. Reads are public; writes are ADMIN only",
    },
    {
      name: "Orders",
      description: "Create, list, view and cancel orders (stock reservation)",
    },
    {
      name: "Payments",
      description: "Stripe Checkout, payment status and webhook",
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "Access token returned by `POST /api/v1/auth/login` (`data.accessToken`). Paste only the token; Swagger adds the `Bearer` prefix.",
      },
      RefreshCookie: {
        type: "apiKey",
        in: "cookie",
        name: "refreshToken",
        description:
          "HttpOnly refresh cookie set by login or the Google callback. It is never returned in a JSON body.",
      },
      StripeSignature: {
        type: "apiKey",
        in: "header",
        name: "stripe-signature",
        description:
          "Signature header added by Stripe. Verified against the raw request body.",
      },
    },
    schemas: {
      // ----- Common -------------------------------------------------------
      ErrorResponse: {
        type: "object",
        required: ["code", "message"],
        properties: {
          code: { type: "string", example: "UNAUTHORIZED" },
          message: { type: "string", example: "Invalid or expired token" },
          errors: {
            type: "array",
            description: "Present on validation errors (422)",
            items: {
              type: "object",
              properties: {
                field: { type: "string", example: "price" },
                message: {
                  type: "string",
                  example: "Price must be greater than zero",
                },
              },
            },
          },
        },
      },
      Pagination: {
        type: "object",
        properties: {
          total: { type: "integer", example: 42 },
          page: { type: "integer", example: 1 },
          limit: { type: "integer", example: 20 },
          totalPages: { type: "integer", example: 3 },
        },
      },

      // ----- Auth ---------------------------------------------------------
      RegisterRequest: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: {
            type: "string",
            format: "email",
            example: "user@example.com",
          },
          password: {
            type: "string",
            format: "password",
            minLength: 10,
            maxLength: 100,
            example: "Password123!",
          },
        },
      },
      UserSummary: {
        type: "object",
        properties: {
          id: {
            type: "string",
            format: "uuid",
            example: "123e4567-e89b-12d3-a456-426614174000",
          },
          email: { type: "string", example: "user@example.com" },
          status: {
            type: "string",
            enum: ["ACTIVE", "DISABLED"],
            example: "ACTIVE",
          },
          roles: {
            type: "array",
            items: { type: "string" },
            example: ["USER"],
          },
        },
      },
      RegisterResponse: {
        type: "object",
        properties: {
          message: { type: "string", example: "User registered successfully" },
          user: ref("UserSummary"),
        },
      },
      LoginRequest: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: {
            type: "string",
            format: "email",
            example: "admin@example.com",
          },
          password: {
            type: "string",
            format: "password",
            minLength: 6,
            maxLength: 100,
            example: "AdminSecurePassword123!",
          },
        },
      },
      LoginResponse: {
        type: "object",
        properties: {
          message: { type: "string", example: "Login successful" },
          data: {
            type: "object",
            properties: {
              accessToken: {
                type: "string",
                example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
              },
              user: {
                type: "object",
                properties: {
                  id: { type: "string", format: "uuid" },
                  email: { type: "string", example: "admin@example.com" },
                  roles: {
                    type: "array",
                    items: { type: "string" },
                    example: ["ADMIN"],
                  },
                },
              },
            },
          },
        },
      },
      RefreshResponse: {
        type: "object",
        properties: {
          message: { type: "string", example: "Token refreshed" },
          data: {
            type: "object",
            properties: {
              accessToken: {
                type: "string",
                example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
              },
            },
          },
        },
      },
      MessageResponse: {
        type: "object",
        properties: {
          message: { type: "string", example: "Logged out successfully" },
        },
      },
      GoogleUrlResponse: {
        type: "object",
        properties: {
          url: {
            type: "string",
            format: "uri",
            example: "https://accounts.google.com/o/oauth2/v2/auth?...",
          },
        },
      },

      // ----- Users --------------------------------------------------------
      UserProfile: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          email: { type: "string", example: "user@example.com" },
          status: { type: "string", enum: ["ACTIVE", "DISABLED"] },
          roles: {
            type: "array",
            items: { type: "string" },
            example: ["USER"],
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      UserProfileResponse: {
        type: "object",
        properties: {
          status: { type: "string", example: "success" },
          data: ref("UserProfile"),
        },
      },

      // ----- Health / Admin ----------------------------------------------
      LivenessResponse: {
        type: "object",
        properties: {
          status: { type: "string", example: "ok" },
          uptimeSeconds: { type: "integer", example: 154 },
          timestamp: {
            type: "string",
            format: "date-time",
            example: "2026-10-03T20:30:00.000Z",
          },
        },
      },
      ReadinessCheck: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["up", "down"], example: "up" },
          latencyMs: { type: "number", example: 2 },
          error: { type: "string", example: "Connection refused" },
        },
      },
      ReadinessResponse: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["ready", "not_ready"],
            example: "ready",
          },
          checks: {
            type: "object",
            properties: {
              database: ref("ReadinessCheck"),
              redis: ref("ReadinessCheck"),
            },
          },
          timestamp: {
            type: "string",
            format: "date-time",
            example: "2026-10-03T20:30:00.000Z",
          },
        },
      },
      AdminHealthResponse: {
        type: "object",
        properties: {
          status: { type: "string", example: "ok" },
          message: { type: "string", example: "Admin health check passed" },
          timestamp: {
            type: "string",
            format: "date-time",
            example: "2026-10-03T20:30:00.000Z",
          },
        },
      },

      // ----- Products -----------------------------------------------------
      Product: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string", example: "Wireless Mouse" },
          description: {
            type: "string",
            example: "2.4GHz ergonomic wireless mouse",
          },
          price: { type: "number", example: 24.99 },
          currency: {
            type: "string",
            enum: ["USD", "EUR", "GBP", "INR"],
            example: "USD",
          },
          status: {
            type: "string",
            enum: ["ACTIVE", "INACTIVE"],
            example: "ACTIVE",
          },
          stock: {
            type: "integer",
            description: "Available (unreserved) quantity",
            example: 100,
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      ProductResponse: {
        type: "object",
        properties: {
          status: { type: "string", example: "success" },
          data: ref("Product"),
        },
      },
      ProductListResponse: {
        type: "object",
        properties: {
          status: { type: "string", example: "success" },
          data: { type: "array", items: ref("Product") },
          pagination: ref("Pagination"),
        },
      },
      CreateProductRequest: {
        type: "object",
        required: ["name", "price"],
        additionalProperties: false,
        properties: {
          name: {
            type: "string",
            minLength: 2,
            maxLength: 120,
            example: "Wireless Mouse",
          },
          description: {
            type: "string",
            maxLength: 1000,
            default: "",
            example: "2.4GHz ergonomic wireless mouse",
          },
          price: {
            type: "number",
            exclusiveMinimum: true,
            minimum: 0,
            multipleOf: 0.01,
            description: "Greater than 0, max 2 decimal places",
            example: 24.99,
          },
          currency: {
            type: "string",
            enum: ["USD", "EUR", "GBP", "INR"],
            default: "USD",
          },
          stock: { type: "integer", minimum: 0, default: 0, example: 100 },
        },
      },
      UpdateProductRequest: {
        type: "object",
        additionalProperties: false,
        description: "Any subset of the create fields.",
        properties: {
          name: { type: "string", minLength: 2, maxLength: 120 },
          description: { type: "string", maxLength: 1000 },
          price: {
            type: "number",
            exclusiveMinimum: true,
            minimum: 0,
            multipleOf: 0.01,
          },
          currency: { type: "string", enum: ["USD", "EUR", "GBP", "INR"] },
          stock: { type: "integer", minimum: 0 },
        },
      },
      ProductStatusRequest: {
        type: "object",
        required: ["status"],
        properties: {
          status: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
        },
      },

      // ----- Orders -------------------------------------------------------
      CreateOrderRequest: {
        type: "object",
        required: ["items"],
        properties: {
          items: {
            type: "array",
            minItems: 1,
            maxItems: 50,
            description:
              "Product IDs must be unique within the order. Prices always come from the database.",
            items: {
              type: "object",
              required: ["productId", "quantity"],
              properties: {
                productId: { type: "string", format: "uuid" },
                quantity: { type: "integer", minimum: 1, example: 2 },
              },
            },
          },
        },
      },
      OrderItem: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          productId: { type: "string", format: "uuid" },
          quantity: { type: "integer", example: 2 },
          unitPrice: {
            type: "string",
            description: "Decimal as string",
            example: "24.99",
          },
          lineTotal: {
            type: "string",
            description: "Decimal as string",
            example: "49.98",
          },
          product: {
            type: "object",
            properties: {
              id: { type: "string", format: "uuid" },
              name: { type: "string", example: "Wireless Mouse" },
              price: { type: "string", example: "24.99" },
            },
          },
        },
      },
      Order: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          userId: { type: "string", format: "uuid" },
          status: {
            type: "string",
            enum: ["PENDING_PAYMENT", "PAID", "CANCELLED", "EXPIRED"],
          },
          totalAmount: {
            type: "string",
            description: "Decimal as string",
            example: "49.98",
          },
          currency: { type: "string", example: "USD" },
          expiresAt: {
            type: "string",
            format: "date-time",
            description: "End of the 60 minute stock reservation",
          },
          items: { type: "array", items: ref("OrderItem") },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      OrderResponse: {
        type: "object",
        properties: {
          status: { type: "string", example: "success" },
          message: { type: "string" },
          data: ref("Order"),
        },
      },
      OrderListResponse: {
        type: "object",
        properties: {
          status: { type: "string", example: "success" },
          data: { type: "array", items: ref("Order") },
          pagination: ref("Pagination"),
        },
      },

      // ----- Payments -----------------------------------------------------
      CheckoutResponse: {
        type: "object",
        properties: {
          status: { type: "string", example: "success" },
          message: {
            type: "string",
            example: "Stripe checkout session initialized",
          },
          data: {
            type: "object",
            properties: {
              checkoutUrl: {
                type: "string",
                format: "uri",
                description: "Redirect the customer here to pay",
                example: "https://checkout.stripe.com/c/pay/cs_test_...",
              },
              sessionId: { type: "string", example: "cs_test_a1b2c3" },
            },
          },
        },
      },
      PaymentStatusResponse: {
        type: "object",
        properties: {
          status: { type: "string", example: "success" },
          data: {
            type: "object",
            properties: {
              orderId: { type: "string", format: "uuid" },
              orderStatus: {
                type: "string",
                enum: ["PENDING_PAYMENT", "PAID", "CANCELLED", "EXPIRED"],
              },
              totalAmount: { type: "string", example: "49.98" },
              currency: { type: "string", example: "USD" },
              paymentStatus: {
                type: "string",
                description: "`NONE` when checkout has not been started",
                example: "PENDING",
              },
              paymentDetails: {
                type: "object",
                nullable: true,
                properties: {
                  id: { type: "string", format: "uuid" },
                  status: { type: "string", example: "PENDING" },
                  createdAt: { type: "string", format: "date-time" },
                },
              },
            },
          },
        },
      },
      WebhookResponse: {
        type: "object",
        properties: {
          received: { type: "boolean", example: true },
          result: {
            type: "object",
            description: "Outcome of processing",
            properties: {
              processed: { type: "boolean", example: true },
              duplicate: {
                type: "boolean",
                description: "True when this event id was already handled",
              },
              ignoredType: {
                type: "string",
                description: "Set when the event type is not handled",
              },
              awaitingPayment: {
                type: "boolean",
                description: "Set when the session is not paid yet",
              },
            },
          },
        },
      },
    },
  },
  paths: {
    // ======================== Root & Health ========================
    "/health/live": {
      get: {
        tags: ["Health"],
        summary: "Liveness check",
        description:
          "Checks whether the process is alive. Used by orchestrators (e.g. Kubernetes) to decide whether to restart the container.",
        responses: { "200": ok("Process is alive", "LivenessResponse") },
      },
    },
    "/health/ready": {
      get: {
        tags: ["Health"],
        summary: "Readiness check",
        description:
          "Verifies PostgreSQL and Redis are reachable. Returns 503 when a required dependency is down.",
        responses: {
          "200": ok("Ready to accept traffic", "ReadinessResponse"),
          "503": ok("One or more dependencies are down", "ReadinessResponse"),
        },
      },
    },

    // ============================ Auth =============================
    "/api/v1/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Register a new user",
        description:
          "Creates a user with an argon2-hashed password and the default `USER` role. A `USER_REGISTERED` event is written to the outbox in the same transaction.",
        requestBody: { required: true, content: json(ref("RegisterRequest")) },
        responses: {
          "201": ok("User created", "RegisterResponse"),
          "409": err("Email already registered"),
          "422": E422,
          "429": E429,
        },
      },
    },
    "/api/v1/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Login with email and password",
        description:
          "Returns the access JWT in the JSON body. The refresh token is set only as an HttpOnly cookie and is never in the body. Requests from untrusted browser origins are rejected.",
        requestBody: { required: true, content: json(ref("LoginRequest")) },
        responses: {
          "200": ok("Login successful (refresh cookie set)", "LoginResponse"),
          "401": err("Invalid credentials or disabled account"),
          "403": err("Untrusted browser origin"),
          "422": E422,
          "429": E429,
        },
      },
    },
    "/api/v1/auth/refresh": {
      post: {
        tags: ["Auth"],
        summary: "Rotate refresh cookie and get a new access token",
        description:
          "Reads the refresh token from the HttpOnly cookie (no request body). The old refresh token is invalidated and a new cookie is issued.",
        security: [{ RefreshCookie: [] }],
        responses: {
          "200": ok(
            "New access token; refresh cookie rotated",
            "RefreshResponse",
          ),
          "401": err("Cookie missing, expired or already used"),
          "403": err("Untrusted browser origin"),
          "429": E429,
        },
      },
    },
    "/api/v1/auth/logout": {
      post: {
        tags: ["Auth"],
        summary: "Log out the current session",
        description:
          "Revokes only the presented refresh session and clears the cookie.",
        security: [{ RefreshCookie: [] }],
        responses: {
          "200": ok("Logged out", "MessageResponse"),
          "403": err("Untrusted browser origin"),
        },
      },
    },
    "/api/v1/auth/me": {
      get: {
        tags: ["Auth"],
        summary: "Current profile (alias of /users/me)",
        security: bearer,
        responses: {
          "200": ok("Current active user", "UserProfileResponse"),
          "401": E401,
        },
      },
    },

    // ========================= Google OAuth ========================
    "/api/v1/auth/google": {
      get: {
        tags: ["Google OAuth"],
        summary: "Get the Google authorization URL",
        description:
          "Also sets a short-lived state/PKCE cookie that the callback verifies.",
        responses: {
          "200": ok("Authorization URL", "GoogleUrlResponse"),
          "503": err("Google OAuth not configured"),
        },
      },
    },
    "/api/v1/auth/google/link": {
      get: {
        tags: ["Google OAuth"],
        summary: "Start linking Google to the logged-in account",
        security: bearer,
        responses: {
          "200": ok("Authorization URL", "GoogleUrlResponse"),
          "401": E401,
        },
      },
    },
    "/api/v1/auth/google/callback": {
      get: {
        tags: ["Google OAuth"],
        summary:
          "Google redirect target: verify state, exchange code, sign in or link",
        description:
          "On sign-in the response matches the login response and sets the refresh cookie. On linking it confirms the link.",
        parameters: [
          {
            name: "state",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "code",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": ok("Login or link completed"),
          "400": E400,
          "401": err("Unverified state or identity"),
        },
      },
    },

    // =========================== Users =============================
    "/api/v1/users/me": {
      get: {
        tags: ["Users"],
        summary: "Get the current user's profile",
        security: bearer,
        responses: {
          "200": ok("Profile", "UserProfileResponse"),
          "401": E401,
          "404": E404,
        },
      },
    },

    // ============================ Admin ============================
    "/api/v1/admin/health": {
      get: {
        tags: ["Admin"],
        summary: "Admin health check",
        description: "Requires a valid token AND the `ADMIN` role.",
        security: bearer,
        responses: {
          "200": ok("Admin authorization check passed", "AdminHealthResponse"),
          "401": E401,
          "403": E403,
        },
      },
    },

    // ========================== Products ===========================
    "/api/v1/products": {
      get: {
        tags: ["Products"],
        summary: "List products (public)",
        description:
          "Paginated, filterable list. Results are cached in Redis with a PostgreSQL fallback.",
        parameters: [
          {
            name: "page",
            in: "query",
            schema: { type: "integer", minimum: 1, default: 1 },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          },
          {
            name: "status",
            in: "query",
            schema: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
          },
          { name: "search", in: "query", schema: { type: "string" } },
          {
            name: "sortBy",
            in: "query",
            schema: {
              type: "string",
              enum: ["createdAt", "price", "name"],
              default: "createdAt",
            },
          },
          {
            name: "sortOrder",
            in: "query",
            schema: { type: "string", enum: ["asc", "desc"], default: "desc" },
          },
        ],
        responses: {
          "200": ok("Products and pagination", "ProductListResponse"),
          "422": E422,
        },
      },
      post: {
        tags: ["Products"],
        summary: "Create a product and its inventory (ADMIN)",
        description:
          "Unknown fields are rejected. `stock` becomes the initial available inventory. Product caches are invalidated.",
        security: bearer,
        requestBody: {
          required: true,
          content: json(ref("CreateProductRequest")),
        },
        responses: {
          "201": ok("Created", "ProductResponse"),
          "401": E401,
          "403": E403,
          "422": E422,
        },
      },
    },
    "/api/v1/products/{id}": {
      get: {
        tags: ["Products"],
        summary: "Get a product by ID (public)",
        parameters: [idParam("Product ID")],
        responses: {
          "200": ok("Product", "ProductResponse"),
          "404": E404,
        },
      },
      patch: {
        tags: ["Products"],
        summary: "Update a product (ADMIN)",
        security: bearer,
        parameters: [idParam("Product ID")],
        requestBody: {
          required: true,
          content: json(ref("UpdateProductRequest")),
        },
        responses: {
          "200": ok("Updated", "ProductResponse"),
          "401": E401,
          "403": E403,
          "404": E404,
          "422": E422,
        },
      },
    },
    "/api/v1/products/{id}/status": {
      patch: {
        tags: ["Products"],
        summary: "Activate or deactivate a product (ADMIN)",
        description: "Inactive products cannot be added to new orders.",
        security: bearer,
        parameters: [idParam("Product ID")],
        requestBody: {
          required: true,
          content: json(ref("ProductStatusRequest")),
        },
        responses: {
          "200": ok("Updated", "ProductResponse"),
          "401": E401,
          "403": E403,
          "404": E404,
          "422": E422,
        },
      },
    },

    // ============================ Orders ===========================
    "/api/v1/orders": {
      get: {
        tags: ["Orders"],
        summary: "List the caller's orders",
        security: bearer,
        parameters: [
          {
            name: "page",
            in: "query",
            schema: { type: "integer", minimum: 1, default: 1 },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 50, default: 10 },
          },
          {
            name: "status",
            in: "query",
            schema: {
              type: "string",
              enum: ["PENDING_PAYMENT", "PAID", "CANCELLED", "EXPIRED"],
            },
          },
        ],
        responses: {
          "200": ok("Orders with pagination", "OrderListResponse"),
          "401": E401,
          "422": E422,
        },
      },
      post: {
        tags: ["Orders"],
        summary: "Create an order and reserve stock",
        description:
          "Atomically reserves stock and creates a `PENDING_PAYMENT` order. Prices are read from the database, never from the client. All items must share one currency. The reservation lasts 60 minutes (`expiresAt`).",
        security: bearer,
        requestBody: {
          required: true,
          content: json(ref("CreateOrderRequest")),
        },
        responses: {
          "201": ok("Order created; stock reserved", "OrderResponse"),
          "400": err("Inactive product or mixed currencies"),
          "401": E401,
          "404": err("Product not found"),
          "409": err("Insufficient stock"),
          "422": E422,
        },
      },
    },
    "/api/v1/orders/{id}": {
      get: {
        tags: ["Orders"],
        summary: "Get an order (owner or ADMIN)",
        security: bearer,
        parameters: [idParam("Order ID")],
        responses: {
          "200": ok("Order with line items", "OrderResponse"),
          "401": E401,
          "403": E403,
          "404": E404,
        },
      },
    },
    "/api/v1/orders/{id}/cancel": {
      post: {
        tags: ["Orders"],
        summary: "Cancel an order and release reserved stock (owner or ADMIN)",
        description:
          "Only `PENDING_PAYMENT` orders can be cancelled, and only before checkout has started. Once a Stripe session exists the order cannot be cancelled.",
        security: bearer,
        parameters: [idParam("Order ID")],
        responses: {
          "200": ok("Cancelled; stock released", "OrderResponse"),
          "400": err("Order is not in PENDING_PAYMENT status"),
          "401": E401,
          "403": E403,
          "404": E404,
          "409": err("Checkout already initiated, or order already finalized"),
        },
      },
    },

    // =========================== Payments ==========================
    "/api/v1/orders/{id}/checkout": {
      post: {
        tags: ["Payments"],
        summary: "Start Stripe Checkout for a pending order",
        description: [
          "Returns a Stripe-hosted `checkoutUrl`; redirect the customer there.",
          "",
          "Rules, in order: order must exist (404), belong to the caller (403), be `PENDING_PAYMENT` (400), and have **more than 31 minutes** of reservation left (409).",
          "",
          "If an open session already exists for the order, the same URL is returned. If that session has expired, a 409 asks you to cancel and create a new order. No request body.",
        ].join("\n"),
        security: bearer,
        parameters: [idParam("Order ID")],
        responses: {
          "200": ok("Checkout URL", "CheckoutResponse"),
          "400": err("Order is not pending payment"),
          "401": E401,
          "403": E403,
          "404": E404,
          "409": err(
            "Not enough reservation time left, or Checkout session no longer open",
          ),
          "503": E503,
        },
      },
    },
    "/api/v1/orders/{id}/payment": {
      get: {
        tags: ["Payments"],
        summary: "Get the server-side payment state (owner or ADMIN)",
        description:
          "The source of truth for whether an order is paid. Poll this after the customer returns from Stripe; the browser redirect alone does not prove payment.",
        security: bearer,
        parameters: [idParam("Order ID")],
        responses: {
          "200": ok("Order and payment status", "PaymentStatusResponse"),
          "401": E401,
          "403": E403,
          "404": E404,
        },
      },
    },
    "/api/v1/webhooks/stripe": {
      post: {
        tags: ["Payments"],
        summary: "Stripe webhook (signature verified, idempotent)",
        description: [
          "Called by Stripe, not by clients. The body is parsed raw so the `stripe-signature` header can be verified.",
          "",
          "Only `checkout.session.completed` with `payment_status = paid` changes anything. In one database transaction it marks the order `PAID`, converts reserved stock into a sale, marks the payment `COMPLETED` and queues the confirmation email via the outbox.",
          "",
          "Duplicate deliveries are detected by the unique Stripe event id and acknowledged with `duplicate: true`.",
        ].join("\n"),
        security: [{ StripeSignature: [] }],
        requestBody: {
          required: true,
          description: "Raw Stripe event JSON",
          content: { "application/json": { schema: { type: "object" } } },
        },
        responses: {
          "200": ok(
            "Event processed, ignored or already handled",
            "WebhookResponse",
          ),
          "400": err("Event missing matching order or payment fields"),
          "401": err("Missing or invalid Stripe signature"),
          "409": err(
            "Amount mismatch, or paid session for an unavailable order (manual reconciliation)",
          ),
          "503": E503,
        },
      },
    },
  },
};

export const swaggerRouter = Router();

// Serve Swagger UI
swaggerRouter.use("/", swaggerUi.serve);
swaggerRouter.get("/", swaggerUi.setup(swaggerDocument));

// Raw OpenAPI JSON spec endpoint
swaggerRouter.get("/json", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.json(swaggerDocument);
});
