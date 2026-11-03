import { Router } from "express";
import {
  loginUser,
  registerUser,
  refreshAccessToken,
  logoutUser,
} from "./auth.controller.js";
import {
  validateUserLogin,
  validateUserRegister,
} from "./auth.validate.js";
import {
  googleAuthUrlHandler,
  googleCallbackHandler,
  googleLinkStartHandler,
} from "./google.controller.js";
import { authenticate } from "../../middlewares/auth.js";
import { getMe } from "../user/user.controller.js";
import { authRateLimit } from "../../middlewares/authRateLimit.js";

const router = Router();

router.post("/register", authRateLimit, validateUserRegister, registerUser);
router.post("/login", authRateLimit, validateUserLogin, loginUser);
router.post("/refresh", authRateLimit, refreshAccessToken);
router.post("/logout", logoutUser);

// Profile endpoint alias
router.get("/me", authenticate, getMe);

// Google OAuth endpoints
router.get("/google", googleAuthUrlHandler);
router.get("/google/callback", googleCallbackHandler);
router.get("/google/link", authenticate, googleLinkStartHandler);

export default router;
