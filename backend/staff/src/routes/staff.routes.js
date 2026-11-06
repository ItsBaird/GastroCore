import { Router } from 'express';
import { create, getById, list, update } from '../controllers/employee.controller.js';
import {
  create as createShift,
  end as endShift,
  list as listShifts,
  start as startShift,
} from '../controllers/shift.controller.js';
import { authenticate, requireRole } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validate.js';
import {
  createEmployeeSchema,
  updateEmployeeSchema,
  userIdParamsSchema,
} from '../schemas/employee.schema.js';
import {
  createShiftSchema,
  listShiftsQuerySchema,
  shiftIdParamsSchema,
} from '../schemas/shift.schema.js';

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
// solo el ADMIN programa turnos. Iniciar y finalizar (GC-STAFF-0003): el propio empleado
// (WAITER, COOK o un ADMIN con turno propio); finalizar tambien lo puede hacer un ADMIN por otro.
staffRouter.get('/shifts', authenticate, validate({ query: listShiftsQuerySchema }), listShifts);
staffRouter.post(
  '/shifts',
  authenticate,
  requireRole('ADMIN'),
  validate({ body: createShiftSchema }),
  createShift,
);

staffRouter.post(
  '/shifts/:id/start',
  authenticate,
  requireRole('WAITER', 'COOK', 'ADMIN'),
  validate({ params: shiftIdParamsSchema }),
  startShift,
);
staffRouter.post(
  '/shifts/:id/end',
  authenticate,
  requireRole('WAITER', 'COOK', 'ADMIN'),
  validate({ params: shiftIdParamsSchema }),
  endShift,
);
