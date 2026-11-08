import { Router } from 'express';
import { listQrRequestsController } from '../controllers/qrRequest.controller.js';
import { authenticate, requireRole } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validate.js';
import { listQrRequestsQuerySchema } from '../schemas/qrRequestList.schema.js';

export const qrRequestRouter = Router();

// Solicitudes de pedido del QR para el MESERO (con sesion), distintas de /qr/:token/* que es publico.
// GC-QR-0003: aqui vivira tambien confirmar y rechazar (PUT /:id/confirm y /:id/reject).
qrRequestRouter.get(
  '/',
  authenticate,
  requireRole('WAITER', 'ADMIN'),
  validate({ query: listQrRequestsQuerySchema }),
  listQrRequestsController,
);
