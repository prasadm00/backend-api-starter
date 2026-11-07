import crypto from "node:crypto";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import {
  generateAccessToken,
  generateOpaqueRefreshToken,
} from "../../common/token.js";
import { createRefreshToken, findUserById } from "./auth.repository.js";
import { refreshTtlMs } from "./auth.cookies.js";
import {
  BadRequestError,
  ConflictError,
  UnauthorizedError,
  AppError,
} from "../../errors/AppError.js";
import { logger } from "../../common/logger.js";

/*
 * Google OAuth 2.0 / OpenID Connect (authorization-code flow) for sign-in and
 * account linking. Called by `google.controller.ts`.
 *
 * Protections used:
 * - `state`: random value echoed back by Google, compared with the one in the flow cookie,
 *   so the callback can only be completed by the browser that started the flow (CSRF).
 * - PKCE (S256): only the hash of a secret `verifier` goes to Google up front; the verifier
 *   itself is sent when exchanging the code, so an intercepted code is useless alone.
 * - `nonce`: sent in the auth request and checked in the ID token, tying the token to this flow.
 * - ID token: signature, issuer, audience and claims are verified before it is trusted.
 */

const PROVIDER = "GOOGLE";
// Issuer/audience of the signed flow cookie (not Google's token); keeps it from being
// accepted as any other JWT this server issues.
const AUTH_ISSUER = "backend-api-oauth";
const AUTH_AUDIENCE = "google-oauth-flow";

/** Per-login secrets and context, kept client-side in a signed cookie between start and callback. */
export interface GoogleFlow {
  mode: "login" | "link";
  state: string;
  nonce: string;
  verifier: string;
  userId?: string;
}

// Fails fast with a 503 (instead of sending users to Google with bad credentials) when
// the OAuth settings are missing or still the placeholder value.
function requireConfiguration() {
  if (
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.GOOGLE_CALLBACK_URL ||
    env.GOOGLE_CLIENT_ID.includes("placeholder")
  ) {
    throw new AppError(
      "Google OAuth is not configured",
      503,
      "OAUTH_UNAVAILABLE",
    );
  }
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    secret: env.GOOGLE_CLIENT_SECRET,
    callback: env.GOOGLE_CALLBACK_URL,
  };
}

/**
 * Builds the Google consent URL and the signed flow cookie value for it.
 *
 * Generates fresh `state`, `nonce` and PKCE verifier/challenge per call. The cookie
 * is a JWT signed with the server secret, so the browser can hold the verifier and
 * nonce without being able to alter them, and it expires after 10 minutes.
 *
 * @param mode `"login"` to sign in/up, `"link"` to attach Google to an existing account.
 * @param userId Required for `"link"`: the account that will receive the Google identity.
 * @returns The `url` to send the user to and the `cookie` value to set.
 * @throws {AppError} 503 when Google OAuth isn't configured.
 * @throws {UnauthorizedError} 401 when linking without a user id.
 */
export function getGoogleAuthUrl(
  mode: "login" | "link" = "login",
  userId?: string,
) {
  const { clientId, callback } = requireConfiguration();
  if (mode === "link" && !userId)
    throw new UnauthorizedError("Authenticate before linking an account");
  logger.info(
    { mode, ...(userId ? { userId } : {}) },
    "Google OAuth flow started",
  );
  const state = crypto.randomBytes(24).toString("hex");
  const nonce = crypto.randomBytes(24).toString("hex");
  const verifier = crypto.randomBytes(32).toString("base64url");
  // PKCE: Google gets only this hash now; the verifier is revealed at code exchange.
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callback,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  const flow: GoogleFlow = {
    mode,
    state,
    nonce,
    verifier,
    ...(userId ? { userId } : {}),
  };
  const cookie = jwt.sign(flow, env.JWT_SECRET, {
    algorithm: "HS256",
    audience: AUTH_AUDIENCE,
    issuer: AUTH_ISSUER,
    expiresIn: "10m",
  });
  console.log("Url==>>", url.toString());
  return { url: url.toString(), cookie };
}

/**
 * Validates the flow cookie and checks that its `state` matches the callback's `state`.
 *
 * @returns The trusted flow data (mode, state, nonce, verifier, optional userId).
 * @throws {UnauthorizedError} 401 when the cookie or state is missing, the cookie is
 *   expired/forged, or the states don't match.
 */
export function verifyGoogleFlow(
  cookie: string | undefined,
  state: string | undefined,
): GoogleFlow {
  if (!cookie || !state) throw new UnauthorizedError("Missing OAuth state");
  let flow: JwtPayload;
  try {
    flow = jwt.verify(cookie, env.JWT_SECRET, {
      algorithms: ["HS256"],
      audience: AUTH_AUDIENCE,
      issuer: AUTH_ISSUER,
    }) as JwtPayload;
  } catch {
    throw new UnauthorizedError("Expired or invalid OAuth state");
  }
  if (
    typeof flow.state !== "string" ||
    // timingSafeEqual throws on different lengths, so compare lengths first.
    flow.state.length !== state.length ||
    !crypto.timingSafeEqual(Buffer.from(flow.state), Buffer.from(state)) ||
    typeof flow.nonce !== "string" ||
    typeof flow.verifier !== "string" ||
    !["login", "link"].includes(flow.mode)
  ) {
    throw new UnauthorizedError("Invalid OAuth state");
  }
  return {
    mode: flow.mode,
    state: flow.state,
    nonce: flow.nonce,
    verifier: flow.verifier,
    ...(typeof flow.userId === "string" ? { userId: flow.userId } : {}),
  };
}

interface GoogleClaims extends JwtPayload {
  sub: string;
  email: string;
  email_verified: boolean;
  nonce: string;
}
// In-memory cache of Google's signing keys: reused for 10 minutes, refetched sooner if a token
// uses an unknown `kid`.
let keysCache:
  { until: number; keys: Array<Record<string, unknown>> } | undefined;
/**
 * Verifies a Google ID token and returns its claims.
 *
 * Checks, in order: RS256 with a `kid`, the signing key from Google's published key
 * set, signature + issuer + audience (our client id), then that `sub` and `email` are
 * present, the email is verified by Google, and `nonce` equals the one from this flow.
 *
 * @throws {UnauthorizedError} 401 when the token or its claims fail any check.
 * @throws {AppError} 503 when Google's keys can't be fetched.
 */
async function verifyGoogleIdToken(
  idToken: string,
  expectedNonce: string,
): Promise<GoogleClaims> {
  const config = requireConfiguration();
  // Decode only to read the header (alg/kid); nothing is trusted until jwt.verify below.
  // Pinning RS256 stops a token from choosing a weaker or "none" algorithm.
  const decoded = jwt.decode(idToken, { complete: true });
  if (
    !decoded ||
    typeof decoded === "string" ||
    decoded.header.alg !== "RS256" ||
    !decoded.header.kid
  ) {
    throw new UnauthorizedError("Invalid Google identity token");
  }
  if (
    !keysCache ||
    keysCache.until < Date.now() ||
    !keysCache.keys.some((k) => k.kid === decoded.header.kid)
  ) {
    const response = await fetch("https://www.googleapis.com/oauth2/v3/certs", {
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok)
      throw new AppError(
        "Google key lookup unavailable",
        503,
        "OAUTH_UNAVAILABLE",
      );
    const result = (await response.json()) as {
      keys?: Array<Record<string, unknown>>;
    };
    keysCache = { keys: result.keys ?? [], until: Date.now() + 10 * 60_000 };
  }
  const jwk = keysCache.keys.find(
    (k) =>
      k.kid === decoded.header.kid &&
      k.kty === "RSA" &&
      (k.use === undefined || k.use === "sig"),
  );
  if (!jwk) throw new UnauthorizedError("Google signing key not found");
  const publicKey = crypto.createPublicKey({ key: jwk as any, format: "jwk" });
  let claims: JwtPayload;
  try {
    claims = jwt.verify(idToken, publicKey, {
      algorithms: ["RS256"],
      issuer: ["accounts.google.com", "https://accounts.google.com"],
      audience: config.clientId,
    }) as JwtPayload;
  } catch {
    throw new UnauthorizedError("Google identity verification failed");
  }
  // email_verified must be true so an unverified address can't be used to claim an email;
  // the nonce check ties this token to the login attempt that started the flow.
  if (
    typeof claims.sub !== "string" ||
    typeof claims.email !== "string" ||
    claims.email_verified !== true ||
    claims.nonce !== expectedNonce
  ) {
    throw new UnauthorizedError("Google identity claims missing or unverified");
  }
  return claims as GoogleClaims;
}

/**
 * Completes the OAuth flow: exchanges the code, verifies the identity, then links or logs in.
 *
 * Link mode attaches the Google identity to `flow.userId`. Login mode finds the user by
 * the Google account id (`sub`), or creates a new passwordless user if the email is unused.
 * Accounts are never matched to an existing user by email alone (see inline comment).
 *
 * @returns `{ linked: true, alreadyLinked }` in link mode; otherwise the access token,
 *   a new refresh token and the public user fields.
 * @throws {UnauthorizedError} 401 when Google rejects the code, the ID token fails
 *   verification, or the account is unavailable.
 * @throws {ConflictError} 409 when the Google identity is linked to another account, or
 *   the email already belongs to an account that hasn't linked Google.
 * @throws {BadRequestError} 400 when the code is missing.
 * @throws {AppError} 503 when Google OAuth isn't configured or unavailable.
 */
export async function handleGoogleCallback(code: string, flow: GoogleFlow) {
  const config = requireConfiguration();
  if (!code) throw new BadRequestError("Google authorization code missing");
  logger.info({ mode: flow.mode }, "Processing Google OAuth callback");
  // Server-to-server code exchange. `code_verifier` proves we started this flow (PKCE).
  const form = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.secret,
    redirect_uri: config.callback,
    grant_type: "authorization_code",
    code_verifier: flow.verifier,
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new UnauthorizedError("Google authorization code rejected");
  const tokens = (await response.json()) as { id_token?: string };
  if (!tokens.id_token)
    throw new UnauthorizedError("Google identity token missing");
  const googleIdentity = await verifyGoogleIdToken(tokens.id_token, flow.nonce);
  // Identity is keyed on Google's stable `sub`, not the email, which can change.
  const providerUserId = googleIdentity.sub;
  const email = googleIdentity.email.trim().toLowerCase();
  logger.info(
    { mode: flow.mode, providerUserId, email },
    "Google identity verified",
  );

  // Link mode: the target account comes from the signed flow cookie created while the user
  // was authenticated, not from the email in the Google token.
  if (flow.mode === "link") {
    if (!flow.userId)
      throw new UnauthorizedError("Account link session missing");
    const owner = await findUserById(flow.userId);
    if (!owner || owner.status !== "ACTIVE")
      throw new UnauthorizedError("Account unavailable");
    const existing = await prisma.oAuthAccount.findUnique({
      where: {
        provider_providerUserId: { provider: PROVIDER, providerUserId },
      },
    });
    if (existing) {
      if (existing.userId !== owner.id) {
        logger.warn(
          { userId: owner.id, providerUserId },
          "Google link blocked: identity already linked to another account",
        );
        throw new ConflictError(
          "Google identity is already linked to another account",
        );
      }
      logger.info(
        { userId: owner.id, providerUserId },
        "Google account already linked",
      );
      return { linked: true, alreadyLinked: true };
    }
    await prisma.oAuthAccount.create({
      data: { userId: owner.id, provider: PROVIDER, providerUserId },
    });
    logger.info({ userId: owner.id, providerUserId }, "Google account linked");
    return { linked: true, alreadyLinked: false };
  }

  const linked = await prisma.oAuthAccount.findUnique({
    where: { provider_providerUserId: { provider: PROVIDER, providerUserId } },
    include: { user: { include: { roles: { include: { role: true } } } } },
  });
  let user = linked?.user;
  if (!user) {
    // A matching email is NOT proof that an existing password account belongs to this identity.
    // Auto-linking by email could let someone take over an account; the owner must sign in
    // and link Google explicitly instead.
    const matching = await prisma.user.findUnique({ where: { email } });
    if (matching) {
      logger.warn(
        { email, providerUserId },
        "Google login blocked: email already registered to a different account",
      );
      throw new ConflictError(
        "Email is already registered; sign in and link Google explicitly",
      );
    }
    const role = await prisma.role.upsert({
      where: { name: "USER" },
      update: {},
      create: { name: "USER" },
    });
    user = await prisma.user.create({
      data: {
        email,
        status: "ACTIVE",
        roles: { create: { roleId: role.id } },
        oauthAccounts: { create: { provider: PROVIDER, providerUserId } },
      },
      include: { roles: { include: { role: true } } },
    });
    logger.info(
      { userId: user.id, email: user.email },
      "New user provisioned via Google login",
    );
  } else {
    logger.info(
      { userId: user.id, email: user.email },
      "Existing user matched via Google identity",
    );
  }
  if (user.status !== "ACTIVE") {
    logger.warn(
      { userId: user.id, status: user.status },
      "Google login blocked: account not active",
    );
    throw new UnauthorizedError("Account unavailable");
  }
  const roles = user.roles.map((r: any) => r.role.name);
  const accessToken = generateAccessToken({
    userId: user.id,
    email: user.email,
    roles,
  });
  const refreshToken = generateOpaqueRefreshToken();
  await createRefreshToken(
    refreshToken,
    user.id,
    new Date(Date.now() + refreshTtlMs()),
  );
  logger.info(
    { userId: user.id, email: user.email, roles },
    "Google login successful",
  );
  return {
    linked: false,
    accessToken,
    refreshToken,
    user: { id: user.id, email: user.email, roles },
  };
}
