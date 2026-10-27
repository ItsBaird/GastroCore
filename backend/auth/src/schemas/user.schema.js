import { z } from 'zod';

export const ROLES = ['ADMIN', 'WAITER', 'COOK'];

// Email en minusculas: la restriccion unica de Postgres distingue mayusculas
const email = z
  .string({ error: 'El email es obligatorio' })
  .trim()
  .toLowerCase()
  .pipe(z.email('Email invalido').max(255, 'El email admite hasta 255 caracteres'));

const role = z.enum(ROLES, { error: 'El rol debe ser ADMIN, WAITER o COOK' });

export const createUserSchema = z.object({
  email,
  password: z
    .string({ error: 'La contrasena es obligatoria' })
    .min(10, 'La contrasena debe tener al menos 10 caracteres')
    .max(128, 'La contrasena admite hasta 128 caracteres'),
  role,
});

export const userIdParamsSchema = z.object({
  id: z.uuid('El id debe ser un UUID valido'),
});

// Solo rol y estado (REQ-F01-07): cambiar rol y bloquear o desbloquear
export const updateUserSchema = z
  .object({
    role: role.optional(),
    isActive: z.boolean({ error: 'isActive debe ser verdadero o falso' }).optional(),
  })
  .refine((data) => data.role !== undefined || data.isActive !== undefined, {
    message: 'Debes enviar al menos role o isActive',
  });
