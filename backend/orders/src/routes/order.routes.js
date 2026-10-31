import { Router } from 'express';
import { getOrderDetailController } from '../controllers/orderDetail.controller.js';
import { authenticate, requireRole } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validate.js';
import { orderIdParamsSchema } from '../schemas/round.schema.js';

export const orderRouter = Router();

orderRouter.get(
  '/:orderId',
  authenticate,
  requireRole('WAITER', 'ADMIN'),
  validate({ params: orderIdParamsSchema }),
  getOrderDetailController,
);
