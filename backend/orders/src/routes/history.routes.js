import { Router } from 'express';
import {
  exportSalesHistoryController,
  salesHistoryController,
  salesHistoryOrderController,
} from '../controllers/history.controller.js';
import { authenticate, requireRole } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validate.js';
import { historyExportQuerySchema, historyQuerySchema } from '../schemas/history.schema.js';
import { orderIdParamsSchema } from '../schemas/round.schema.js';

export const historyRouter = Router();

// GC-RPT-0003. Historial de ventas, solo ADMIN. (GC-189 detalle y GC-190 exportacion a Excel, abajo.)
historyRouter.get(
  '/',
  authenticate,
  requireRole('ADMIN'),
  validate({ query: historyQuerySchema }),
  salesHistoryController,
);

// GC-190. Exportacion a Excel con los mismos filtros (sin paginar). Va ANTES de /:orderId.
historyRouter.get(
  '/export',
  authenticate,
  requireRole('ADMIN'),
  validate({ query: historyExportQuerySchema }),
  exportSalesHistoryController,
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
