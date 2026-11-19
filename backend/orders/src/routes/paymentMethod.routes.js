import { Router } from 'express';
import { create, list, update } from '../controllers/paymentMethod.controller.js';
import { authenticate, requireRole } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validate.js';
import {
  createPaymentMethodSchema,
  listPaymentMethodsQuerySchema,
  paymentMethodIdParamsSchema,
  updatePaymentMethodSchema,
} from '../schemas/paymentMethod.schema.js';

export const paymentMethodRouter = Router();

// Cualquier usuario autenticado puede listar (el mesero pide ?active=true al cobrar);
// solo el ADMIN crea, edita o desactiva. El contrato no define DELETE: los metodos no se borran.
paymentMethodRouter.get(
  '/',
  authenticate,
  validate({ query: listPaymentMethodsQuerySchema }),
  list,
);
paymentMethodRouter.post(
  '/',
  authenticate,
  requireRole('ADMIN'),
  validate({ body: createPaymentMethodSchema }),
  create,
);
paymentMethodRouter.put(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  validate({ params: paymentMethodIdParamsSchema, body: updatePaymentMethodSchema }),
  update,
);
