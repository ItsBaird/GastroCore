import { Router } from 'express';
import { cancelItemController, updateItemStatusController } from '../controllers/item.controller.js';
import { authenticate, requireRole } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validate.js';
import {
  cancelItemBodySchema,
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

itemRouter.put(
  '/:id/status',
  authenticate,
  requireRole('COOK', 'ADMIN'),
  validate({ params: itemIdParamsSchema, body: itemStatusBodySchema }),
  updateItemStatusController,
);
