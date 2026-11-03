import { Router } from "express";
import { authenticate, authorize } from "../../middlewares/auth.js";
import { getAdminHealth } from "./admin.controller.js";

const router = Router();

// GET /health protected by authenticate and authorize("ADMIN")
router.get("/health", authenticate, authorize("ADMIN"), getAdminHealth);

export default router;
