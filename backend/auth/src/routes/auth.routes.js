import { Router } from 'express';
import { register } from '../controllers/user.controller.js';
import { authenticate, requireRole } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validate.js';
import { createUserSchema } from '../schemas/user.schema.js';

export const authRouter = Router();

// Solo un ADMIN autenticado puede crear cuentas (GC-AUTH-0001)
authRouter.post(
  '/register',
  authenticate,
  requireRole('ADMIN'),
  validate({ body: createUserSchema }),
  register,
);
