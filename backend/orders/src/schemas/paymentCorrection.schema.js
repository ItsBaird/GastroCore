import { z } from 'zod';

// GC-RPT-0002 (GC-157). Correccion del metodo de pago de una venta ya cobrada. R4: el cliente solo dice a QUE
// metodo cambiar (y, si es efectivo, lo recibido) y POR QUE; subtotal, descuento, total y cambio los calcula o
// conserva el servidor (.strict() rechaza cualquier otro campo). El motivo queda en audit_log, por eso es
// obligatorio y sin espacios sobrantes. El tope de amountReceived es el maximo de una columna INT de PostgreSQL.
export const paymentCorrectionBodySchema = z
  .object({
    paymentMethodId: z.string().uuid(),
    amountReceived: z.number().int().min(0).max(2_147_483_647).optional(),
    reason: z
      .string({ error: 'El motivo es obligatorio' })
      .trim()
      .min(5, 'El motivo debe tener al menos 5 caracteres')
      .max(200, 'El motivo no puede superar los 200 caracteres'),
  })
  .strict();
