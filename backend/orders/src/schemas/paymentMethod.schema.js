import { z } from 'zod';

const name = z
  .string({ error: 'El nombre es obligatorio' })
  .trim()
  .min(1, 'El nombre es obligatorio')
  .max(50, 'El nombre admite hasta 50 caracteres');

// PaymentMethodInput del contrato: al crear, isCash vale false e isActive true si no se envian
export const createPaymentMethodSchema = z
  .object({
    name,
    isCash: z.boolean().optional().default(false),
    isActive: z.boolean().optional().default(true),
  })
  .strict();

// En PUT lo que no se envia queda como esta (no se reinicia a los valores por defecto): asi se puede
// renombrar sin tocar isActive, o desactivar enviando el nombre y isActive=false.
export const updatePaymentMethodSchema = z
  .object({
    name,
    isCash: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const paymentMethodIdParamsSchema = z.object({
  id: z.string().uuid(),
});

// GET ?active=true (los meseros solo necesitan los activos). Sin el filtro devuelve todos.
export const listPaymentMethodsQuerySchema = z.object({
  active: z
    .enum(['true', 'false'], { error: 'active debe ser true o false' })
    .transform((v) => v === 'true')
    .optional(),
});
