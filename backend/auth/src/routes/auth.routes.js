import { Router } from 'express';
import { deactivate, getById, list, register, update } from '../controllers/user.controller.js';
import { authenticate, requireRole } from '../middlewares/authenticate.js';
import { validate } from '../middlewares/validate.js';
import { createUserSchema, updateUserSchema, userIdParamsSchema } from '../schemas/user.schema.js';

export const authRouter = Router();

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
