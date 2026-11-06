import { Router } from 'express';
import { create, getById, list, update } from '../controllers/employee.controller.js';
import { create as createShift, list as listShifts } from '../controllers/shift.controller.js';
import { authenticate, requireRole } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validate.js';
import {
  createEmployeeSchema,
  updateEmployeeSchema,
  userIdParamsSchema,
} from '../schemas/employee.schema.js';
import { createShiftSchema, listShiftsQuerySchema } from '../schemas/shift.schema.js';

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

// Turnos (F02). Segun el contrato, cualquier usuario autenticado puede consultar el horario;
// solo el ADMIN programa turnos. Iniciar/finalizar (GC-STAFF-0003) se agrega aparte.
staffRouter.get('/shifts', authenticate, validate({ query: listShiftsQuerySchema }), listShifts);
staffRouter.post(
  '/shifts',
  authenticate,
  requireRole('ADMIN'),
  validate({ body: createShiftSchema }),
  createShift,
);
