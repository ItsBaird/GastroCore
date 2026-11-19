import { Router } from 'express';
import { attendServiceCallController } from '../controllers/serviceCall.controller.js';
import { authenticate, requireRole } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validate.js';
import {
  attendServiceCallBodySchema,
  serviceCallIdParamsSchema,
} from '../schemas/serviceCall.schema.js';

export const serviceCallRouter = Router();

// Llamados al mesero (service_calls) para el MESERO (con sesion), distintos de /qr/:token/call que es publico.
serviceCallRouter.put(
  '/:id/attend',
  authenticate,
  requireRole('WAITER', 'ADMIN'),
  validate({ params: serviceCallIdParamsSchema, body: attendServiceCallBodySchema }),
  attendServiceCallController,
);
