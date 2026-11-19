import { Router } from 'express';
import { env } from '../config/env.js';
import { deactivate, getById, list, register, update } from '../controllers/user.controller.js';
import {
  loginController,
  logoutController,
  refreshController,
} from '../controllers/auth.controller.js';
import { authenticate, requireRole } from '../middlewares/authenticate.js';
import { createRateLimiter } from '../middlewares/rateLimiter.js';
import { validate } from '../middlewares/validate.js';
import {
  createUserSchema,
  loginSchema,
  updateUserSchema,
  userIdParamsSchema,
} from '../schemas/user.schema.js';

export const authRouter = Router();

// Publico: el login es la unica forma de obtener un token. Limite por IP antes de validar, asi que cuenta todo
// intento (correcto, incorrecto o mal formado), como hacia nginx. Ademas la cuenta se bloquea tras varios fallos.
const loginLimiter = createRateLimiter({
  limit: env.loginRateLimit,
  message: 'Demasiados intentos de inicio de sesión. Espera un minuto e inténtalo de nuevo.',
});
authRouter.post('/login', loginLimiter, validate({ body: loginSchema }), loginController);

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
