import { Router } from 'express';
import { dashboardController } from '../controllers/dashboard.controller.js';
import { authenticate, requireRole } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validate.js';
import { dashboardQuerySchema } from '../schemas/dashboard.schema.js';

// GC-RPT-0004. Router propio montado en /reports junto al de Oscar (reports.routes.js no se edita): lo que este
// no atiende pasa al siguiente. Solo ADMIN, validado en la ruta y no solo en el frontend.
export const dashboardRouter = Router();

dashboardRouter.get(
  '/dashboard',
  authenticate,
  requireRole('ADMIN'),
  validate({ query: dashboardQuerySchema }),
  dashboardController,
);
