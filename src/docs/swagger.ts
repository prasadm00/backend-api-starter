import { Router } from "express";
import swaggerUi from "swagger-ui-express";

export const swaggerDocument = {
  openapi: "3.0.0",
  info: {
    title: "Backend API Documentation",
    version: "1.0.0",
    description:
      "E-commerce backend REST API: secure auth, Product/Order CRUD, Stripe Checkout and webhook, Google OIDC, Redis caching and BullMQ transactional outbox.",
  },
  servers: [
    {
      url: "http://localhost:3000",
      description: "Local development server",
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Enter your JWT Access Token (e.g. Bearer eyJhbGciOi...)",
      },
    },
    schemas: {
      ErrorResponse: {
        type: "object",
        properties: {
          code: {
            type: "string",
            example: "UNAUTHORIZED",
          },
          message: {
            type: "string",
            example: "Invalid or expired token",
          },
          errors: {
            type: "object",
            description: "Optional validation error details",
          },
        },
        required: ["code", "message"],
      },
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
            minLength: 6,
            example: "Password123!",
          },
        },
      },
      RegisterResponse: {
        type: "object",
        properties: {
          message: {
            type: "string",
            example: "User registered successfully",
          },
          user: {
            type: "object",
            properties: {
              id: {
                type: "string",
                format: "uuid",
                example: "123e4567-e89b-12d3-a456-426614174000",
              },
              email: {
                type: "string",
                example: "user@example.com",
              },
              status: {
                type: "string",
                example: "ACTIVE",
              },
              roles: {
                type: "array",
                items: {
                  type: "string",
                },
                example: ["USER"],
              },
            },
          },
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
            example: "AdminPassword123!",
          },
        },
      },
      LoginResponse: {
        type: "object",
        properties: {
          message: {
            type: "string",
            example: "Login successful!",
          },
          data: {
            type: "object",
            properties: {
              accessToken: {
                type: "string",
                example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
              },
              refreshToken: {
                type: "string",
                example: "4a73d32847cbb6509f7a...",
              },
              user: {
                type: "object",
                properties: {
                  id: {
                    type: "string",
                    example: "123e4567-e89b-12d3-a456-426614174000",
                  },
                  email: {
                    type: "string",
                    example: "admin@example.com",
                  },
                },
              },
            },
          },
        },
      },
      RefreshTokenRequest: {
        type: "object",
        required: ["refreshToken"],
        properties: {
          refreshToken: {
            type: "string",
            example: "4a73d32847cbb6509f7a...",
          },
        },
      },
      RefreshTokenResponse: {
        type: "object",
        properties: {
          accessToken: {
            type: "string",
            example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
          },
          refreshToken: {
            type: "string",
            example: "5b84e43958dcc7610a8b...",
          },
        },
      },
      LivenessResponse: {
        type: "object",
        properties: {
          status: {
            type: "string",
            example: "ok",
          },
          uptimeSeconds: {
            type: "integer",
            example: 154,
          },
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
          status: {
            type: "string",
            enum: ["up", "down"],
            example: "up",
          },
          latencyMs: {
            type: "number",
            example: 2,
          },
          error: {
            type: "string",
            example: "Connection refused",
          },
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
              database: {
                $ref: "#/components/schemas/ReadinessCheck",
              },
              redis: {
                $ref: "#/components/schemas/ReadinessCheck",
              },
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
          status: {
            type: "string",
            example: "ok",
          },
          message: {
            type: "string",
            example: "Admin health check passed",
          },
          timestamp: {
            type: "string",
            format: "date-time",
            example: "2026-10-03T20:30:00.000Z",
          },
        },
      },
    },
  },
  paths: {
    "/health/live": {
      get: {
        tags: ["Health"],
        summary: "Liveness Check",
        description:
          "Checks whether the application process is alive and responsive. Used by container orchestrators (e.g. Kubernetes) to decide whether to restart the container.",
        responses: {
          "200": {
            description: "Process is alive",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/LivenessResponse",
                },
              },
            },
          },
        },
      },
    },
    "/health/ready": {
      get: {
        tags: ["Health"],
        summary: "Readiness Check",
        description:
          "Verifies that downstream dependencies (PostgreSQL Database and Redis Cache) are reachable. Returns 200 when ready to accept traffic, or 503 if any required dependency fails ('Don't Send Traffic').",
        responses: {
          "200": {
            description: "Service is ready to handle requests",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ReadinessResponse",
                },
              },
            },
          },
          "503": {
            description:
              "Service unavailable: one or more dependencies are down",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ReadinessResponse",
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Register a new user",
        description:
          "Creates a new user account with hashed password and default 'USER' role. Triggers the 'USER_REGISTERED' event on the queue after the database transaction is committed.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/RegisterRequest",
              },
            },
          },
        },
        responses: {
          "201": {
            description: "User created successfully",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/RegisterResponse",
                },
              },
            },
          },
          "400": {
            description: "Bad Request: Validation failed",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ErrorResponse",
                },
              },
            },
          },
          "409": {
            description: "Conflict: Email already registered",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ErrorResponse",
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Login with email and password",
        description:
          "Verifies user credentials. Returns JWT access token (with embedded user roles) and sets secure httpOnly refresh token cookie.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/LoginRequest",
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Login successful",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/LoginResponse",
                },
              },
            },
          },
          "401": {
            description: "Unauthorized: Invalid email or password",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ErrorResponse",
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/auth/refresh": {
      post: {
        tags: ["Auth"],
        summary: "Refresh access token",
        description:
          "Exchanges a valid refresh token for a newly issued access token and rotated refresh token.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/RefreshTokenRequest",
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Tokens refreshed successfully",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/RefreshTokenResponse",
                },
              },
            },
          },
          "401": {
            description: "Unauthorized: Invalid or expired refresh token",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ErrorResponse",
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/auth/logout": {
      post: {
        tags: ["Auth"],
        summary: "Logout user",
        description:
          "Revokes user refresh tokens to prevent further token renewal.",
        responses: {
          "200": {
            description: "Logged out successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: {
                      type: "string",
                      example: "Logged out successfully",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/admin/health": {
      get: {
        tags: ["Admin"],
        summary: "Admin Health Check",
        description:
          "Protected administrative endpoint requiring valid authentication AND 'ADMIN' role authorization.",
        security: [
          {
            BearerAuth: [],
          },
        ],
        responses: {
          "200": {
            description: "Admin authorization check passed",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/AdminHealthResponse",
                },
              },
            },
          },
          "401": {
            description:
              "Unauthorized: Missing, invalid, or expired authentication token",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ErrorResponse",
                },
              },
            },
          },
          "403": {
            description:
              "Forbidden: Authenticated but insufficient permissions (requires ADMIN role)",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ErrorResponse",
                },
              },
            },
          },
        },
      },
    },
  },
};

// API catalog extension - mounted endpoints are the source of truth.
Object.assign(swaggerDocument.components.securitySchemes, {
  RefreshCookie: {
    type: "apiKey",
    in: "cookie",
    name: "refreshToken",
    description: "HttpOnly refresh cookie set by login or Google callback",
  },
});
Object.assign(swaggerDocument.paths, {
  "/api/v1/auth/login": {
    post: {
      tags: ["Auth"],
      summary: "Password login (sets HttpOnly refresh cookie)",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/LoginRequest" },
          },
        },
      },
      responses: {
        "200": {
          description:
            "Access JWT in JSON; refresh token only in HttpOnly cookie",
        },
        "401": { description: "Invalid credentials or disabled account" },
        "429": { description: "Rate limit" },
      },
    },
  },
  "/api/v1/auth/refresh": {
    post: {
      tags: ["Auth"],
      summary: "Rotate refresh cookie; return access JWT",
      security: [{ RefreshCookie: [] }],
      responses: {
        "200": { description: "New access token; rotated refresh cookie" },
        "401": { description: "Missing, reused or expired refresh cookie" },
        "403": { description: "Untrusted browser origin" },
      },
    },
  },
  "/api/v1/auth/logout": {
    post: {
      tags: ["Auth"],
      summary: "Revoke presented refresh session and clear cookie",
      security: [{ RefreshCookie: [] }],
      responses: { "200": { description: "Session logged out" } },
    },
  },
  "/api/v1/auth/me": {
    get: {
      tags: ["Auth"],
      summary: "Current profile",
      security: [{ BearerAuth: [] }],
      responses: {
        "200": { description: "Current active user" },
        "401": { description: "No/invalid JWT or disabled user" },
      },
    },
  },
  "/api/v1/auth/google": {
    get: {
      tags: ["Google OAuth"],
      summary: "Get Google authorization URL and establish state/PKCE cookie",
      responses: {
        "200": { description: "Returns URL" },
        "503": { description: "Google OAuth not configured" },
      },
    },
  },
  "/api/v1/auth/google/link": {
    get: {
      tags: ["Google OAuth"],
      summary: "Begin explicit Google account linking",
      security: [{ BearerAuth: [] }],
      responses: { "200": { description: "Returns URL" } },
    },
  },
  "/api/v1/auth/google/callback": {
    get: {
      tags: ["Google OAuth"],
      summary:
        "Verify state, exchange code, verify Google ID token and sign in/link",
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
        "200": { description: "Login or linking completed" },
        "401": { description: "Unverified state or identity" },
      },
    },
  },
  "/api/v1/products": {
    get: {
      tags: ["Products"],
      summary: "List products with pagination/filtering",
      parameters: [
        { name: "page", in: "query", schema: { type: "integer", default: 1 } },
        {
          name: "limit",
          in: "query",
          schema: { type: "integer", default: 20 },
        },
        {
          name: "status",
          in: "query",
          schema: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
        },
        { name: "search", in: "query", schema: { type: "string" } },
      ],
      responses: { "200": { description: "Products and pagination" } },
    },
    post: {
      tags: ["Products"],
      summary: "Create product and inventory (ADMIN)",
      security: [{ BearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["name", "price"],
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                price: { type: "number" },
                currency: {
                  type: "string",
                  enum: ["USD", "EUR", "GBP", "INR"],
                },
                stock: { type: "integer" },
              },
            },
          },
        },
      },
      responses: {
        "201": { description: "Created" },
        "403": { description: "ADMIN required" },
      },
    },
  },
  "/api/v1/products/{id}": {
    get: {
      tags: ["Products"],
      summary: "Get product by ID",
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        "200": { description: "Product" },
        "404": { description: "Not found" },
      },
    },
    patch: {
      tags: ["Products"],
      summary: "Update product (ADMIN)",
      security: [{ BearerAuth: [] }],
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: { "200": { description: "Updated" } },
    },
  },
  "/api/v1/products/{id}/status": {
    patch: {
      tags: ["Products"],
      summary: "Activate/deactivate product (ADMIN)",
      security: [{ BearerAuth: [] }],
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: { "200": { description: "Updated" } },
    },
  },
  "/api/v1/orders": {
    get: {
      tags: ["Orders"],
      summary: "List caller's orders",
      security: [{ BearerAuth: [] }],
      responses: { "200": { description: "Orders with pagination" } },
    },
    post: {
      tags: ["Orders"],
      summary: "Reserve inventory and create pending order",
      security: [{ BearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["items"],
              properties: {
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["productId", "quantity"],
                    properties: {
                      productId: { type: "string", format: "uuid" },
                      quantity: { type: "integer", minimum: 1 },
                    },
                  },
                },
              },
            },
          },
        },
      },
      responses: {
        "201": { description: "Order created; stock reserved" },
        "409": { description: "Out of stock" },
      },
    },
  },
  "/api/v1/orders/{id}": {
    get: {
      tags: ["Orders"],
      summary: "Get own order (or ADMIN)",
      security: [{ BearerAuth: [] }],
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        "200": { description: "Order" },
        "403": { description: "Not owner" },
      },
    },
  },
  "/api/v1/orders/{id}/cancel": {
    post: {
      tags: ["Orders"],
      summary: "Cancel order before checkout begins and release stock",
      security: [{ BearerAuth: [] }],
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        "200": { description: "Cancelled" },
        "409": { description: "Payment initiated or order finalized" },
      },
    },
  },
  "/api/v1/orders/{id}/checkout": {
    post: {
      tags: ["Payments"],
      summary: "Create Stripe Checkout session for a pending order",
      security: [{ BearerAuth: [] }],
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        "200": { description: "Checkout URL" },
        "503": { description: "Stripe not configured" },
      },
    },
  },
  "/api/v1/orders/{id}/payment": {
    get: {
      tags: ["Payments"],
      summary: "Get trusted server-side payment state",
      security: [{ BearerAuth: [] }],
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: { "200": { description: "Order/payment status" } },
    },
  },
  "/api/v1/webhooks/stripe": {
    post: {
      tags: ["Payments"],
      summary: "Signature-verified raw-body Stripe webhook",
      responses: {
        "200": { description: "Event processed or safely ignored" },
        "401": { description: "Invalid signature" },
        "409": { description: "Reconciliation required" },
      },
    },
  },
});

export const swaggerRouter = Router();

// Serve Swagger UI
swaggerRouter.use("/", swaggerUi.serve);
swaggerRouter.get("/", swaggerUi.setup(swaggerDocument));

// Raw OpenAPI JSON spec endpoint
swaggerRouter.get("/json", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.json(swaggerDocument);
});
