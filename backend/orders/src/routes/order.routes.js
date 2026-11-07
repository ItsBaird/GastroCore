import { Router } from 'express';
import { cancelBillController, getBillController } from '../controllers/bill.controller.js';
import { getOrderDetailController } from '../controllers/orderDetail.controller.js';
import { authenticate, requireRole } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validate.js';
import { billQuerySchema, cancelBillBodySchema } from '../schemas/bill.schema.js';
import { orderIdParamsSchema } from '../schemas/round.schema.js';

export const orderRouter = Router();

orderRouter.get(
  '/:orderId',
  authenticate,
  requireRole('WAITER', 'ADMIN'),
  validate({ params: orderIdParamsSchema }),
  getOrderDetailController,
);

// GC-ORD-0006. Mesero asignado o ADMIN; la pertenencia la decide el servicio.
orderRouter.get(
  '/:orderId/bill',
  authenticate,
  requireRole('WAITER', 'ADMIN'),
  validate({ params: orderIdParamsSchema, query: billQuerySchema }),
  getBillController,
);

// GC-ORD-0006. Cancelar el cobro: mesero asignado o ADMIN, sin cuerpo.
orderRouter.post(
  '/:orderId/cancel-bill',
  authenticate,
  requireRole('WAITER', 'ADMIN'),
  validate({ params: orderIdParamsSchema, body: cancelBillBodySchema }),
  cancelBillController,
);
