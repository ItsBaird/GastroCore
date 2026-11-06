import { z } from 'zod';

// multipart/form-data entrega todos los campos como texto: se convierten aqui.
// R4/R5: el precio es un entero en COP, sin decimales.
const price = z
  .string({ error: 'El precio es obligatorio' })
  .trim()
  .regex(/^\d{1,9}$/, 'El precio debe ser un entero en COP (0 o mayor, sin decimales)')
  .transform(Number);

const isAvailable = z
  .enum(['true', 'false'], { error: 'isAvailable debe ser true o false' })
  .transform((v) => v === 'true');

// ProductForm del contrato (la foto llega aparte, en req.file)
export const createProductSchema = z.object({
  name: z
    .string({ error: 'El nombre es obligatorio' })
    .trim()
    .min(1, 'El nombre es obligatorio')
    .max(120, 'El nombre admite hasta 120 caracteres'),
  // Un campo vacio se guarda como "sin descripcion"
  description: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  price,
  categoryId: z.uuid('La categoria debe ser un UUID valido'),
  isAvailable: isAvailable.optional().default(true),
});
