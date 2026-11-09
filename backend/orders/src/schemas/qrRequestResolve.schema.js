import { z } from 'zod';
import { createRoundBodySchema } from './round.schema.js';

export const qrRequestIdParamsSchema = z.object({
  id: z.string().uuid(),
});

// Confirmar: el cuerpo es opcional. Sin items se confirma tal cual la pidio el cliente; con items el mesero
// los ajusta (reemplazan a los de la solicitud). Las reglas de cada item son las mismas que al crear una ronda
// (se reutiliza el esquema de rondas para que no puedan divergir). Nunca precios (R4).
export const confirmQrRequestBodySchema = z
  .object({ items: createRoundBodySchema.shape.items.optional() })
  .strict()
  .optional();

// Rechazar no recibe cuerpo ni parametros de consulta
export const rejectQrRequestBodySchema = z.object({}).strict().optional();
