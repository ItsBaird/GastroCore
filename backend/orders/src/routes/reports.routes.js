import { Router } from 'express';
import { cashClosePreviewController } from '../controllers/reports.controller.js';
import { authenticate, requireRole } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validate.js';
import { cashCloseQuerySchema } from '../schemas/cashClose.schema.js';

export const reportsRouter = Router();

// Reportes del ADMIN. GC-RPT-0001: vista previa del cierre de caja. Confirmar el cierre (POST, GC-RPT-0002)
// vivira en esta misma ruta.
reportsRouter.get(
  '/cash-close',
  authenticate,
  requireRole('ADMIN'),
  validate({ query: cashCloseQuerySchema }),
  cashClosePreviewController,
);
