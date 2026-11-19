import { Router } from 'express';
import { listNames } from '../controllers/employee.controller.js';
import { activeShift } from '../controllers/shift.controller.js';
import { requireServiceToken } from '../middlewares/serviceToken.js';
import { validate } from '../middlewares/validate.js';
import { employeeNamesQuerySchema, userIdParamsSchema } from '../schemas/employee.schema.js';

// Rutas /internal/*: solo accesibles dentro de la red de Docker (el gateway las bloquea) y con
// X-Service-Token. Las usan otros servicios, no el navegador.
export const internalRouter = Router();

// /internal/health (sin token) sigue en app.js: solo sirve para comprobar que el gateway bloquea /internal
internalRouter.use('/shifts', requireServiceToken());
internalRouter.use('/employees', requireServiceToken());

// Orders lo consulta para mostrar en el panel quien atiende cada mesa
internalRouter.get('/employees', validate({ query: employeeNamesQuerySchema }), listNames);

// REQ-F02-05: Orders lo consulta antes de abrir una mesa (409 NO_ACTIVE_SHIFT si no hay turno activo)
internalRouter.get('/shifts/active/:userId', validate({ params: userIdParamsSchema }), activeShift);
