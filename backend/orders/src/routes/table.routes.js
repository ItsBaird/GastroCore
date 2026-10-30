import { Router } from 'express';
import { openTableController } from '../controllers/openTable.controller.js';
import { create, list, update } from '../controllers/table.controller.js';
import { getTableStatuses } from '../controllers/tableStatus.controller.js';
import { authenticate, requireRole } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validate.js';
import {
  createTableSchema,
  tableIdParamsSchema,
  updateTableSchema,
} from '../schemas/table.schema.js';

export const tableRouter = Router();

tableRouter.get('/', authenticate, list);

tableRouter.get('/status', authenticate, requireRole('WAITER', 'ADMIN'), getTableStatuses);

tableRouter.post(
  '/',
  authenticate,
  requireRole('ADMIN'),
  validate({ body: createTableSchema }),
  create,
);
tableRouter.post(
  '/:id/open',
  authenticate,
  requireRole('WAITER', 'ADMIN'),
  validate({ params: tableIdParamsSchema }),
  openTableController,
);
tableRouter.put(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  validate({ params: tableIdParamsSchema, body: updateTableSchema }),
  update,
);
