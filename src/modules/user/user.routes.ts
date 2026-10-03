

import { Router } from "express";
import { authenticate } from "../../middlewares/auth";

const router = Router();

router.get("/me", authenticate, )

export default router;