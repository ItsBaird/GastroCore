import { Router } from 'express';
import {
  salesHistoryController,
  salesHistoryOrderController,
} from '../controllers/history.controller.js';
import { authenticate, requireRole } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validate.js';
import { historyQuerySchema } from '../schemas/history.schema.js';
import { orderIdParamsSchema } from '../schemas/round.schema.js';

export const historyRouter = Router();

// GC-RPT-0003. Historial de ventas, solo ADMIN. (GC-190 agrega la exportacion a Excel.)
historyRouter.get(
  '/',
  authenticate,
  requireRole('ADMIN'),
  validate({ query: historyQuerySchema }),
  salesHistoryController,
);

// GC-189. Detalle de una venta. Las rutas fijas (/export, GC-190) deben declararse ANTES que esta: si no,
// '/export' llegaria aqui como orderId y responderia 400 por no ser UUID.
historyRouter.get(
  '/:orderId',
  authenticate,
  requireRole('ADMIN'),
  validate({ params: orderIdParamsSchema }),
  salesHistoryOrderController,
);
