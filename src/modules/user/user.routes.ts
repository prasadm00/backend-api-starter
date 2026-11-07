import { Router } from "express";
import { authenticate } from "../../middlewares/auth.js";
import { getMe } from "./user.controller.js";

/*
 * User routes: maps URLs to middleware and controllers
 * (routes -> controller -> service -> repository). There is no validate step yet.
 */
const router = Router();

// GET /api/v1/users/me
router.get("/me", authenticate, getMe);

export default router;
