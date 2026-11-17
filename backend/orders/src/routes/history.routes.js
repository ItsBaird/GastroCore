import { Router } from 'express';
import { salesHistoryController } from '../controllers/history.controller.js';
import { authenticate, requireRole } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validate.js';
import { historyQuerySchema } from '../schemas/history.schema.js';

export const historyRouter = Router();

// GC-RPT-0003. Historial de ventas, solo ADMIN. (GC-189 y GC-190 agregan el detalle y la exportacion a Excel.)
historyRouter.get(
  '/',
  authenticate,
  requireRole('ADMIN'),
  validate({ query: historyQuerySchema }),
  salesHistoryController,
);
