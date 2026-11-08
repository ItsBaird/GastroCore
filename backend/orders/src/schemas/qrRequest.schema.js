import { z } from 'zod';

// El contrato fija el maximo de items por solicitud (20). El tope de unidades por linea no esta en el
// contrato: en un endpoint publico un numero absurdo (o uno que desborde el INT de la base) acabaria en un
// 500, asi que se limita aqui y se documenta en la propuesta de contrato.
export const MAX_ITEMS_PER_REQUEST = 20;
export const MAX_QUANTITY_PER_ITEM = 99;

// La nota es opcional; una nota vacia (solo espacios) cuenta como "sin nota"
const note = z
  .string()
  .trim()
  .max(255, 'La nota admite hasta 255 caracteres')
  .transform((value) => (value === '' ? undefined : value))
  .optional();

// R4: el cliente solo envia que producto, cuantas unidades y una nota. Nunca precios, totales, mesa ni estado.
const qrRequestItemSchema = z
  .object({
    productId: z.string().uuid('El producto debe ser un UUID valido'),
    quantity: z
      .number({ error: 'La cantidad debe ser un numero entero' })
      .int('La cantidad debe ser un numero entero')
      .min(1, 'La cantidad minima es 1')
      .max(MAX_QUANTITY_PER_ITEM, `La cantidad maxima por producto es ${MAX_QUANTITY_PER_ITEM}`),
    note,
  })
  .strict();

// QrRequestInput del contrato. .strict() rechaza cualquier otro campo (precio, estado, orderId...)
export const qrRequestBodySchema = z
  .object({
    items: z
      .array(qrRequestItemSchema)
      .min(1, 'Envia al menos un producto')
      .max(MAX_ITEMS_PER_REQUEST, `Una solicitud admite hasta ${MAX_ITEMS_PER_REQUEST} productos`),
  })
  .strict();
