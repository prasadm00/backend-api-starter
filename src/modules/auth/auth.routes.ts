import express from "express";
import {
  loginUser,
  registerUser,
  refreshAccessToken,
  logoutUser,
} from "./auth.controller";
import {
  validateUserLogin,
  validateUserRegister,
  validateRefreshToken,
} from "./auth.validate";

const router = express.Router();

router.post("/register", validateUserRegister, registerUser);
router.post("/login", validateUserLogin, loginUser);
router.post("/refresh", validateRefreshToken, refreshAccessToken);
router.post("/logout", logoutUser);

export default router;
