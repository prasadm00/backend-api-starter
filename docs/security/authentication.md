# Authentication & Token Management

This document details the authentication flow, password hashing, JWT generation, and refresh token rotation mechanisms.

---

## 1. Authentication Lifecycle

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant AuthRouter as Auth Controller
    participant AuthService as Auth Service
    participant Repo as Auth Repository
    participant DB as PostgreSQL DB

    Client->>AuthRouter: POST /api/v1/auth/login (email, password)
    AuthRouter->>AuthService: loginUser(input)
    AuthService->>Repo: findUserByEmail(email)
    Repo->>DB: Query User with Roles
    DB-->>Repo: User record with passwordHash & roles
    Repo-->>AuthService: User entity

    AuthService->>AuthService: argon2.verify(passwordHash, password)
    Note over AuthService: Password valid

    AuthService->>AuthService: generateAccessToken({ userId, email, roles })
    AuthService->>AuthService: crypto.randomBytes(40).toString('hex')
    AuthService->>Repo: createRefreshToken(tokenHash, userId, expiresAt)
    Repo->>DB: INSERT INTO "RefreshToken"
    DB-->>Repo: Created token
    Repo-->>AuthService: Token record

    AuthService-->>AuthRouter: { accessToken, refreshToken, user }
    AuthRouter->>Client: 200 OK + Set-Cookie: refreshToken (httpOnly)
```

---

## 2. Password Security with Argon2

Passwords are encrypted using **Argon2id** via the `argon2` library:

* **Hashing during Registration (`src/modules/auth/auth.repository.ts`)**:
  ```ts
  const passwordHash = await argon2.hash(data.password);
  ```
* **Verification during Login (`src/modules/auth/auth.service.ts`)**:
  ```ts
  const isPasswordValid = await argon2.verify(userExists.passwordHash || "", password);
  if (!isPasswordValid) {
    throw new UnauthorizedError("Invalid email or password");
  }
  ```

---

## 3. JWT Access Token Structure

Access tokens are signed using HMAC-SHA256 with the secret `env.JWT_SECRET`:

* **Expiration**: Configurable via `env.JWT_EXPIRES_IN` (default: `15m`).
* **Payload Claims**:
  ```json
  {
    "userId": "uuid-v4",
    "email": "user@example.com",
    "roles": ["USER", "ADMIN"],
    "iat": 1727980000,
    "exp": 1727980900
  }
  ```

---

## 4. Refresh Token Rotation (RTR)

To protect against token theft, refresh tokens follow a strict rotation model:

```mermaid
flowchart TD
    ReqToken["Client submits refreshToken"] --> Lookup["Query DB for tokenHash & unrevoked status"]
    Lookup --> Found{"Valid & Unrevoked?"}
    Found -- "No" --> Reject["401 Unauthorized\n(Token invalid or reused)"]
    Found -- "Yes" --> RevokeOld["Revoke Old Token\nSET revokedAt = NOW()"]
    RevokeOld --> IssueNew["Generate New Access Token & New Refresh Token"]
    IssueNew --> SaveNew["Persist New Refresh Token in DB"]
    SaveNew --> Respond["Return New Access Token & Set New Cookie"]
```

1. **Exchange**: The client sends the refresh token to `POST /api/v1/auth/refresh`.
2. **Revocation**: The old refresh token is marked revoked immediately (`revokedAt = new Date()`).
3. **Re-issuance**: A new access token and a brand-new cryptographically random refresh token are created and stored.
4. **Logout**: When `POST /api/v1/auth/logout` is called, all active refresh tokens for the user are revoked.
