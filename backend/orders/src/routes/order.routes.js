import { Router } from 'express';
import {
  applyDiscountController,
  cancelBillController,
  getBillController,
  startBillingController,
} from '../controllers/bill.controller.js';
import { getOrderDetailController } from '../controllers/orderDetail.controller.js';
import { authenticate, requireRole } from '../middlewares/authenticate.js';
import { requireDiscountPermission } from '../middlewares/requireDiscountPermission.js';
import { validate } from '../middlewares/validate.js';
import { billQuerySchema, emptyBodySchema } from '../schemas/bill.schema.js';
import { discountBodySchema } from '../schemas/discount.schema.js';
import { orderIdParamsSchema } from '../schemas/round.schema.js';

export const orderRouter = Router();

orderRouter.get(
  '/:orderId',
  authenticate,
  requireRole('WAITER', 'ADMIN'),
  validate({ params: orderIdParamsSchema }),
  getOrderDetailController,
);

// GC-ORD-0006. Ver la cuenta (solo lectura). Mesero asignado o ADMIN; la pertenencia la decide el servicio.
orderRouter.get(
  '/:orderId/bill',
  authenticate,
  requireRole('WAITER', 'ADMIN'),
  validate({ params: orderIdParamsSchema, query: billQuerySchema }),
  getBillController,
);

// GC-ORD-0006. Solicitar el cobro: pasa la orden a EN_COBRO. Distinto de qr/{token}/request-bill.
orderRouter.post(
  '/:orderId/start-billing',
  authenticate,
  requireRole('WAITER', 'ADMIN'),
  validate({ params: orderIdParamsSchema, body: emptyBodySchema }),
  startBillingController,
);

// GC-ORD-0006. Cancelar el cobro: mesero asignado o ADMIN, sin cuerpo.
orderRouter.post(
  '/:orderId/cancel-bill',
  authenticate,
  requireRole('WAITER', 'ADMIN'),
  validate({ params: orderIdParamsSchema, body: emptyBodySchema }),
  cancelBillController,
);

// GC-ORD-0007. Aplicar, cambiar o quitar el descuento: discount:apply (o ADMIN); pertenencia en el servicio.
orderRouter.post(
  '/:orderId/discount',
  authenticate,
  requireRole('WAITER', 'ADMIN'),
  requireDiscountPermission,
  validate({ params: orderIdParamsSchema, body: discountBodySchema }),
  applyDiscountController,
);
