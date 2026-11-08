import { z } from 'zod';

// R4: la cuenta no acepta nada del cliente. Cualquier parametro (total, precio, descuento) es 400.
export const billQuerySchema = z.object({}).strict();

// Solicitar y cancelar el cobro no llevan datos: sin cuerpo o {} vacio.
export const emptyBodySchema = z.object({}).strict().optional();
