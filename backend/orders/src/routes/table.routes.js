import { Router } from 'express';
import { create, list, update } from '../controllers/table.controller.js';
import { authenticate, requireRole } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validate.js';
import {
  createTableSchema,
  tableIdParamsSchema,
  updateTableSchema,
} from '../schemas/table.schema.js';

export const tableRouter = Router();

// Por ruta (no tableRouter.use global): el contrato solo exige sesion para listar
// (GET /tables, cualquier rol autenticado), mientras que crear y editar son solo ADMIN.
// Futuras rutas de GC-ORD-0001/0002 (/tables/status, /tables/:id/open) seran de WAITER.
tableRouter.get('/', authenticate, list);
tableRouter.post(
  '/',
  authenticate,
  requireRole('ADMIN'),
  validate({ body: createTableSchema }),
  create,
);
tableRouter.put(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  validate({ params: tableIdParamsSchema, body: updateTableSchema }),
  update,
);
