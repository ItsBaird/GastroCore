import { z } from 'zod';

export const categoryIdParamsSchema = z.object({
  id: z.uuid('El id debe ser un UUID valido'),
});

// CategoryInput del contrato. En PUT, displayOrder omitido deja el valor actual; null lo borra
export const categoryInputSchema = z.object({
  name: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, 'El nombre es obligatorio')
    .max(80, 'El nombre admite hasta 80 caracteres'),
  displayOrder: z
    .number({ error: 'El orden debe ser un numero entero' })
    .int('El orden debe ser un numero entero')
    .min(0, 'El orden no puede ser negativo')
    .max(10000, 'El orden admite hasta 10000')
    .nullable()
    .optional(),
});
