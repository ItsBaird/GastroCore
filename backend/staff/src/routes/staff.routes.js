import { Router } from 'express';
import { create, getById, list, update } from '../controllers/employee.controller.js';
import { authenticate, requireRole } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validate.js';
import {
  createEmployeeSchema,
  updateEmployeeSchema,
  userIdParamsSchema,
} from '../schemas/employee.schema.js';

export const staffRouter = Router();

// Empleados (F02): solo el ADMIN. El contrato no define DELETE: los perfiles no se borran
staffRouter.use('/employees', authenticate, requireRole('ADMIN'));
staffRouter.get('/employees', list);
staffRouter.post('/employees', validate({ body: createEmployeeSchema }), create);
staffRouter.get('/employees/:userId', validate({ params: userIdParamsSchema }), getById);
staffRouter.put(
  '/employees/:userId',
  validate({ params: userIdParamsSchema, body: updateEmployeeSchema }),
  update,
);
