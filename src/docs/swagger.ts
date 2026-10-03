import { Router } from "express";
import swaggerUi from "swagger-ui-express";

export const swaggerDocument = {
  openapi: "3.0.0",
  info: {
    title: "Backend API Documentation",
    version: "1.0.0",
    description:
      "Production-ready REST API featuring JWT Authentication, Role-Based Access Control (RBAC), Queue event publishing, Redis integration, and Kubernetes-compliant Health Checks.",
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
            description: "Service unavailable: one or more dependencies are down",
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

export const swaggerRouter = Router();

// Serve Swagger UI
swaggerRouter.use("/", swaggerUi.serve);
swaggerRouter.get("/", swaggerUi.setup(swaggerDocument));

// Raw OpenAPI JSON spec endpoint
swaggerRouter.get("/json", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.json(swaggerDocument);
});
