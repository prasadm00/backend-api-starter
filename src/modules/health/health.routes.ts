import { Router } from "express";
import { getLiveness, getReadiness } from "./health.controller.js";

/*
 * Health routes. Neither route uses authenticate, so probes can call them without a token.
 * /live = liveness (process is up), /ready = readiness (database and Redis reachable).
 */
const router = Router();

router.get("/live", getLiveness);
router.get("/ready", getReadiness);

export default router;
