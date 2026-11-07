import { Router } from "express";
import { authenticate } from "../../middlewares/auth.js";
import {
  createOrderHandler,
  getOrderHandler,
  listOrdersHandler,
  cancelOrderHandler,
} from "./order.controller.js";
import { validateCreateOrder, validateOrderQuery } from "./order.validate.js";

const router = Router();

/*
 * Order routes: maps URLs to middleware and controllers
 * (routes -> validate -> controller -> service -> repository).
 */

// All order endpoints require authentication
router.use(authenticate);

router.post("/", validateCreateOrder, createOrderHandler);
router.get("/", validateOrderQuery, listOrdersHandler);
router.get("/:id", getOrderHandler);
router.post("/:id/cancel", cancelOrderHandler);

export default router;
