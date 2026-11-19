import { Router } from 'express';
import { correctPaymentMethodController } from '../controllers/paymentCorrection.controller.js';
import { authenticate, requireRole } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validate.js';
import { paymentCorrectionBodySchema } from '../schemas/paymentCorrection.schema.js';
import { orderIdParamsSchema } from '../schemas/round.schema.js';

export const paymentCorrectionRouter = Router();

// GC-RPT-0002 (GC-157). Correccion post-cobro/post-cierre: solo ADMIN, siempre auditada.
paymentCorrectionRouter.patch(
  '/:orderId/payment',
  authenticate,
  requireRole('ADMIN'),
  validate({ params: orderIdParamsSchema, body: paymentCorrectionBodySchema }),
  correctPaymentMethodController,
);
