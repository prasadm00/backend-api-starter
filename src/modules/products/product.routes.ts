import { Router } from "express";
import { authenticate, authorize } from "../../middlewares/auth.js";
import {
  createProductHandler,
  getProductHandler,
  listProductsHandler,
  updateProductHandler,
  changeProductStatusHandler,
} from "./product.controller.js";
import {
  validateProductCreate,
  validateProductUpdate,
  validateProductStatus,
  validateProductQuery,
} from "./product.validate.js";

/*
 * Product routes: maps URLs to middleware and controllers
 * (routes -> validate -> controller -> service -> repository).
 * Reads are public; writes require authentication and the ADMIN role.
 */
const router = Router();

// Public routes
router.get("/", validateProductQuery, listProductsHandler);
router.get("/:id", getProductHandler);

// Admin-only mutations
router.post(
  "/",
  authenticate,
  authorize("ADMIN"),
  validateProductCreate,
  createProductHandler,
);

router.patch(
  "/:id",
  authenticate,
  authorize("ADMIN"),
  validateProductUpdate,
  updateProductHandler,
);

router.patch(
  "/:id/status",
  authenticate,
  authorize("ADMIN"),
  validateProductStatus,
  changeProductStatusHandler,
);

export default router;
