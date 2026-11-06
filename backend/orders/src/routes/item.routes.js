import { Router } from 'express';
import { cancelItemController } from '../controllers/item.controller.js';
import { authenticate, requireRole } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validate.js';
import { cancelItemBodySchema, itemIdParamsSchema } from '../schemas/item.schema.js';

export const itemRouter = Router();

itemRouter.post(
  '/:id/cancel',
  authenticate,
  requireRole('WAITER', 'ADMIN'),
  validate({ params: itemIdParamsSchema, body: cancelItemBodySchema }),
  cancelItemController,
);
