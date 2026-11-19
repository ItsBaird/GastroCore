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

const name = z
  .string({ error: 'El nombre es obligatorio' })
  .trim()
  .min(1, 'El nombre es obligatorio')
  .max(120, 'El nombre admite hasta 120 caracteres');

// Un campo vacio se guarda como "sin descripcion"
const description = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v));

const categoryId = z.uuid('La categoria debe ser un UUID valido');

export const productIdParamsSchema = z.object({
  id: z.uuid('El id debe ser un UUID valido'),
});

// ProductForm del contrato (la foto llega aparte, en req.file)
export const createProductSchema = z.object({
  name,
  description: description.optional(),
  price,
  categoryId,
  isAvailable: isAvailable.optional().default(true),
});

// PUT: cada campo es opcional (solo se cambia lo que se envia). Asi el mismo endpoint sirve para
// editar el producto y para el interruptor de disponibilidad (solo isAvailable).
export const updateProductSchema = z.object({
  name: name.optional(),
  description: description.optional(),
  price: price.optional(),
  categoryId: categoryId.optional(),
  isAvailable: isAvailable.optional(),
});

// GET /internal/products?ids=a,b,c (contrato: ids separados por coma)
export const internalProductsQuerySchema = z.object({
  ids: z
    .string()
    .transform((value) => [...new Set(value.split(',').map((id) => id.trim()))])
    .pipe(z.array(z.uuid()).min(1).max(100)),
});
