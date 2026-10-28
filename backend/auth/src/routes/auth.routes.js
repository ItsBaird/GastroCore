import { Router } from 'express';
import { deactivate, getById, list, register, update } from '../controllers/user.controller.js';
import {
  loginController,
  logoutController,
  refreshController,
} from '../controllers/auth.controller.js';
import { authenticate, requireRole } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validate.js';
import {
  createUserSchema,
  loginSchema,
  updateUserSchema,
  userIdParamsSchema,
} from '../schemas/user.schema.js';

export const authRouter = Router();

// Publico: el login es la unica forma de obtener un token (el gateway limita 5/min por IP)
authRouter.post('/login', validate({ body: loginSchema }), loginController);

// Publicos: se identifican por la cookie httpOnly del refresh token, no por el access token
// (que puede estar vencido justo cuando se necesita renovar o cerrar sesion)
authRouter.post('/refresh', refreshController);
authRouter.post('/logout', logoutController);

// Solo un ADMIN autenticado administra cuentas (GC-AUTH-0001)
authRouter.use(['/register', '/users'], authenticate, requireRole('ADMIN'));

authRouter.post('/register', validate({ body: createUserSchema }), register);

authRouter.get('/users', list);
authRouter.get('/users/:id', validate({ params: userIdParamsSchema }), getById);
authRouter.put(
  '/users/:id',
  validate({ params: userIdParamsSchema, body: updateUserSchema }),
  update,
);
authRouter.delete('/users/:id', validate({ params: userIdParamsSchema }), deactivate);
