import { z } from 'zod';

// R4: el cliente solo envia el monto (pesos enteros, R5) y un motivo opcional. Quien aplica, cuando, el
// subtotal y el total los decide el servidor: .strict() rechaza cualquier otro campo. 0 quita el descuento.
// El tope es el maximo de una columna INT de PostgreSQL; el limite real (el subtotal) lo valida el servicio.
export const discountBodySchema = z
  .object({
    discountAmount: z.number().int().min(0).max(2_147_483_647),
    reason: z.string().trim().min(1).max(255).optional(),
  })
  .strict();
