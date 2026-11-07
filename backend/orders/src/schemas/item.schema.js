import { z } from 'zod';

export const itemIdParamsSchema = z.object({
  id: z.string().uuid(),
});

// Los 5 estados reales son validos aqui: pedir uno no permitido es 409 INVALID_TRANSITION (lo decide
// el servicio segun el estado actual) y uno inventado es 400 VALIDATION_ERROR (decision K6).
export const itemStatusBodySchema = z
  .object({
    status: z.enum(['pendiente', 'en_preparacion', 'listo', 'entregado', 'cancelado']),
  })
  .strict();

// R4: el cliente solo envia el motivo. .strict() rechaza status, cancelledBy y cualquier otro campo.
// El trim corre antes del minimo, asi que un motivo de solo espacios es VALIDATION_ERROR.
export const cancelItemBodySchema = z
  .object({
    reason: z.string().trim().min(1).max(255),
  })
  .strict();
