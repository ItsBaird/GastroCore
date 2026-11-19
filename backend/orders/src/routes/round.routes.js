import { Router } from 'express';
import { createRoundController } from '../controllers/round.controller.js';
import { authenticate, requireRole } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validate.js';
import {
  createRoundBodySchema,
  createRoundParamsSchema,
} from '../schemas/round.schema.js';

export const roundRouter = Router({ mergeParams: true });

roundRouter.post(
  '/',
  authenticate,
  requireRole('WAITER', 'ADMIN'),
  validate({ params: createRoundParamsSchema, body: createRoundBodySchema }),
  createRoundController,
);
