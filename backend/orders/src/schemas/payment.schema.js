import { z } from 'zod';

// GC-ORD-0008. R4: el cliente solo envia el metodo y, con efectivo, lo que entrego el cliente (pesos
// enteros, R5). Total, subtotal, descuento y cambio los calcula el servidor: .strict() rechaza cualquier
// otro campo. Si `amountReceived` es obligatorio o prohibido depende del metodo (lo decide el servicio).
// El tope es el maximo de una columna INT de PostgreSQL.
export const paymentBodySchema = z
  .object({
    paymentMethodId: z.string().uuid(),
    amountReceived: z.number().int().min(0).max(2_147_483_647).optional(),
  })
  .strict();
