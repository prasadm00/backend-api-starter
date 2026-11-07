import { Router } from "express";
import { authenticate, authorize } from "../../middlewares/auth.js";
import { getAdminHealth } from "./admin.controller.js";

/*
 * Admin routes: every route here must pass authenticate (valid token) and then
 * authorize("ADMIN") (role check), in that order.
 */
const router = Router();

// GET /health protected by authenticate and authorize("ADMIN")
router.get("/health", authenticate, authorize("ADMIN"), getAdminHealth);

export default router;
