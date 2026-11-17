import { Router } from 'express';
import {
  cashClosePreviewController,
  confirmCashCloseController,
} from '../controllers/reports.controller.js';
import { authenticate, requireRole } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validate.js';
import { cashCloseBodySchema, cashCloseQuerySchema } from '../schemas/cashClose.schema.js';

export const reportsRouter = Router();

// Reportes del ADMIN. GC-RPT-0001: vista previa del cierre de caja (GET). GC-RPT-0002: confirmarlo (POST).
reportsRouter.get(
  '/cash-close',
  authenticate,
  requireRole('ADMIN'),
  validate({ query: cashCloseQuerySchema }),
  cashClosePreviewController,
);

reportsRouter.post(
  '/cash-close',
  authenticate,
  requireRole('ADMIN'),
  validate({ body: cashCloseBodySchema }),
  confirmCashCloseController,
);
