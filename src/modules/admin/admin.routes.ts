import { Router } from "express";
import { authenticate, authorize } from "../../middlewares/auth";
import { getAdminHealth } from "./admin.controller";

const router = Router();

// GET /health protected by authenticate() and authorize("ADMIN")
router.get("/health", authenticate(), authorize("ADMIN"), getAdminHealth);

export default router;
