/*
 * Auth routes: the HTTP surface of the auth module. Each route runs optional
 * middleware (rate limit, body validation, `authenticate`) and then hands off to
 * a controller; controllers call `auth.service.ts` / `google.service.ts`, which
 * use `auth.repository.ts` for database access.
 */
import { Router } from "express";
import {
  loginUser,
  registerUser,
  refreshAccessToken,
  logoutUser,
} from "./auth.controller.js";
import { validateUserLogin, validateUserRegister } from "./auth.validate.js";
import {
  googleAuthUrlHandler,
  googleCallbackHandler,
  googleLinkStartHandler,
} from "./google.controller.js";
import { authenticate } from "../../middlewares/auth.js";
import { getMe } from "../user/user.controller.js";
import { authRateLimit } from "../../middlewares/authRateLimit.js";

const router = Router();

// Credential-handling endpoints are rate limited; validation runs before the handler.
router.post("/register", authRateLimit, validateUserRegister, registerUser);
router.post("/login", authRateLimit, validateUserLogin, loginUser);
router.post("/refresh", authRateLimit, refreshAccessToken);
router.post("/logout", logoutUser);

// Profile endpoint alias
router.get("/me", authenticate, getMe);

// Google OAuth endpoints. `/google/link` requires a logged-in user (attaches Google to
// an existing account); `/google` and `/google/callback` are the sign-in flow.
router.get("/google", googleAuthUrlHandler);
router.get("/google/callback", googleCallbackHandler);
router.get("/google/link", authenticate, googleLinkStartHandler);

export default router;
