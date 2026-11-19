import { Router } from 'express';
import {
  confirmQrRequestController,
  listQrRequestsController,
  rejectQrRequestController,
} from '../controllers/qrRequest.controller.js';
import { authenticate, requireRole } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validate.js';
import { listQrRequestsQuerySchema } from '../schemas/qrRequestList.schema.js';
import {
  confirmQrRequestBodySchema,
  qrRequestIdParamsSchema,
  rejectQrRequestBodySchema,
} from '../schemas/qrRequestResolve.schema.js';

export const qrRequestRouter = Router();

// Solicitudes de pedido del QR para el MESERO (con sesion), distintas de /qr/:token/* que es publico.
qrRequestRouter.get(
  '/',
  authenticate,
  requireRole('WAITER', 'ADMIN'),
  validate({ query: listQrRequestsQuerySchema }),
  listQrRequestsController,
);

// GC-QR-0003: resolver una solicitud. El mesero asignado o el ADMIN (el servicio comprueba la mesa).
qrRequestRouter.put(
  '/:id/confirm',
  authenticate,
  requireRole('WAITER', 'ADMIN'),
  validate({ params: qrRequestIdParamsSchema, body: confirmQrRequestBodySchema }),
  confirmQrRequestController,
);

qrRequestRouter.put(
  '/:id/reject',
  authenticate,
  requireRole('WAITER', 'ADMIN'),
  validate({ params: qrRequestIdParamsSchema, body: rejectQrRequestBodySchema }),
  rejectQrRequestController,
);
