import { z } from 'zod';

export const itemIdParamsSchema = z.object({
  id: z.string().uuid(),
});

// R4: el cliente solo envia el motivo. .strict() rechaza status, cancelledBy y cualquier otro campo.
// El trim corre antes del minimo, asi que un motivo de solo espacios es VALIDATION_ERROR.
export const cancelItemBodySchema = z
  .object({
    reason: z.string().trim().min(1).max(255),
  })
  .strict();
