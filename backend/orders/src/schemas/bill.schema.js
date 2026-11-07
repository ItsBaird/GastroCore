import { z } from 'zod';

// R4: la cuenta no acepta nada del cliente. Cualquier parametro (total, precio, descuento) es 400.
export const billQuerySchema = z.object({}).strict();

// Cancelar el cobro no lleva datos: sin cuerpo o {} vacio.
export const cancelBillBodySchema = z.object({}).strict().optional();
