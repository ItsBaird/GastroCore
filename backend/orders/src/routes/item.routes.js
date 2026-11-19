import { Router } from 'express';
import {
  cancelItemController,
  deliverItemController,
  updateItemStatusController,
} from '../controllers/item.controller.js';
import { authenticate, requireRole } from '../middlewares/authenticate.js';
import { requireCookShift } from '../middlewares/requireCookShift.js';
import { validate } from '../middlewares/validate.js';
import {
  cancelItemBodySchema,
  deliverItemBodySchema,
  itemIdParamsSchema,
  itemStatusBodySchema,
} from '../schemas/item.schema.js';

export const itemRouter = Router();

itemRouter.post(
  '/:id/cancel',
  authenticate,
  requireRole('WAITER', 'ADMIN'),
  validate({ params: itemIdParamsSchema, body: cancelItemBodySchema }),
  cancelItemController,
);

// GC-ORD-0005. Mesero asignado o ADMIN; la pertenencia la decide el servicio.
itemRouter.put(
  '/:id/deliver',
  authenticate,
  requireRole('WAITER', 'ADMIN'),
  validate({ params: itemIdParamsSchema, body: deliverItemBodySchema }),
  deliverItemController,
);

itemRouter.put(
  '/:id/status',
  authenticate,
  requireRole('COOK', 'ADMIN'),
  requireCookShift,
  validate({ params: itemIdParamsSchema, body: itemStatusBodySchema }),
  updateItemStatusController,
);
