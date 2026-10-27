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

tableRouter.use(authenticate, requireRole('ADMIN'));

tableRouter.get('/', list);
tableRouter.post('/', validate({ body: createTableSchema }), create);
tableRouter.put('/:id', validate({ params: tableIdParamsSchema, body: updateTableSchema }), update);
