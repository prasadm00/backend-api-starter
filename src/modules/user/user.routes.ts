import { Router } from "express";
import { authenticate } from "../../middlewares/auth.js";
import { getMe } from "./user.controller.js";

const router = Router();

// GET /api/v1/users/me
router.get("/me", authenticate, getMe);

export default router;