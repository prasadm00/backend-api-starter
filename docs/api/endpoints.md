# API Endpoints & Specification

This document provides a complete reference for all HTTP endpoints exposed by the API, including payload contracts, authentication schemes, and Swagger documentation.

---

## 1. Swagger & OpenAPI Documentation

The API includes an embedded **OpenAPI 3.0** specification served interactively via Swagger UI:

| Resource | URL | Description |
| :--- | :--- | :--- |
| **Swagger UI** | `http://localhost:3000/docs` | Interactive API explorer & testing sandbox |
| **Alternative UI Path** | `http://localhost:3000/api-docs` | Mirror route for Swagger UI |
| **OpenAPI Spec (JSON)** | `http://localhost:3000/docs/json` | Raw OpenAPI 3.0 JSON specification |

---

## 2. Global Error Response Standard

All errors return a predictable JSON payload:

```json
{
  "code": "ERROR_CODE",
  "message": "Human readable error description",
  "errors": {
    "field": "Optional validation or diagnostic details"
  }
}
```

### Standard Status Codes
* `400 Bad Request` (`BAD_REQUEST`): Malformed JSON or input validation failure.
* `401 Unauthorized` (`UNAUTHORIZED`): Missing or invalid authentication token.
* `403 Forbidden` (`FORBIDDEN`): Authenticated user lacks required role/permission.
* `404 Not Found` (`NOT_FOUND`): Target resource does not exist.
* `409 Conflict` (`CONFLICT`): Resource already registered (e.g. duplicate email).
* `422 Unprocessable Entity` (`VALIDATION_ERROR`): Schema validation errors.
* `500 Internal Error` (`INTERNAL_ERROR`): Unhandled system exceptions.
* `503 Service Unavailable` (`NOT_READY`): Readiness check failure.

---

## 3. Endpoints Catalog

### Health Module

#### `GET /health/live`
* **Auth**: None
* **Description**: Liveness probe confirming Node.js event loop is operational.
* **Response `200 OK`**:
  ```json
  {
    "status": "ok",
    "uptimeSeconds": 128,
    "timestamp": "2026-10-03T20:30:00.000Z"
  }
  ```

#### `GET /health/ready`
* **Auth**: None
* **Description**: Readiness probe querying PostgreSQL (`SELECT 1`) and Redis (`PING`).
* **Response `200 OK`** (Ready):
  ```json
  {
    "status": "ready",
    "checks": {
      "database": { "status": "up", "latencyMs": 2 },
      "redis": { "status": "up", "latencyMs": 1 }
    },
    "timestamp": "2026-10-03T20:30:00.000Z"
  }
  ```
* **Response `503 Service Unavailable`** (Degraded):
  ```json
  {
    "status": "not_ready",
    "checks": {
      "database": { "status": "down", "error": "Database connection refused" },
      "redis": { "status": "up" }
    },
    "timestamp": "2026-10-03T20:30:00.000Z"
  }
  ```

---

### Authentication Module

#### `POST /api/v1/auth/register`
* **Auth**: None
* **Description**: Creates a new user with default role `USER`. Dispatches `USER_REGISTERED` event after DB commit.
* **Request Body**:
  ```json
  {
    "email": "jane@example.com",
    "password": "SecurePassword123!"
  }
  ```
* **Response `201 Created`**:
  ```json
  {
    "message": "User registered successfully",
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "jane@example.com",
      "status": "ACTIVE",
      "roles": ["USER"]
    }
  }
  ```

#### `POST /api/v1/auth/login`
* **Auth**: None
* **Description**: Verifies credentials. Returns JWT access token (with user roles) and sets httpOnly refresh token cookie.
* **Request Body**:
  ```json
  {
    "email": "admin@example.com",
    "password": "AdminPassword123!"
  }
  ```
* **Response `200 OK`**:
  ```json
  {
    "message": "Login successful!",
    "data": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "refreshToken": "4a73d32847cbb6509f7a8340...",
      "user": {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "email": "admin@example.com"
      }
    }
  }
  ```

#### `POST /api/v1/auth/refresh`
* **Auth**: None (Refresh Token required in payload)
* **Description**: Exchanges valid refresh token for rotated tokens.
* **Request Body**:
  ```json
  {
    "refreshToken": "4a73d32847cbb6509f7a8340..."
  }
  ```
* **Response `200 OK`**:
  ```json
  {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "e93ab238f92110c71a823b19..."
  }
  ```

#### `POST /api/v1/auth/logout`
* **Auth**: None / Authenticated
* **Description**: Revokes active user refresh tokens.
* **Response `200 OK`**:
  ```json
  {
    "message": "Logged out successfully"
  }
  ```

---

### Admin Module

#### `GET /api/v1/admin/health`
* **Auth**: Bearer JWT (`authenticate()`)
* **Role Required**: `ADMIN` (`authorize("ADMIN")`)
* **Description**: Protected administrative health inspection.
* **Headers**: `Authorization: Bearer <ADMIN_ACCESS_TOKEN>`
* **Response `200 OK`**:
  ```json
  {
    "status": "ok",
    "message": "Admin health check passed",
    "timestamp": "2026-10-03T20:30:00.000Z"
  }
  ```
* **Response `401 Unauthorized`**: If token is missing, expired, or invalid.
* **Response `403 Forbidden`**: If token has role `USER` instead of `ADMIN`.
