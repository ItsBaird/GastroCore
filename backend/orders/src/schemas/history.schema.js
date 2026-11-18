import { z } from 'zod';
import { daysInRange } from '../services/businessDay.js';
import { dateField } from './cashClose.schema.js';

export const MAX_HISTORY_DAYS = 366;

// GC-RPT-0003. Filtros del historial de ventas, comunes al listado (GC-188) y a la exportacion a Excel (GC-190).
// Las fechas son dias de negocio (AAAA-MM-DD reales) y van JUNTAS: con una sola no se adivina la otra (igual que el
// dashboard). Sin ninguna, el servicio usa el dia actual. El rango cuenta ambos extremos y no pasa de 366 dias.
// Los ids son UUID. Cualquier otro parametro es 400 (.strict()): un filtro que no existe no se ignora.
const filters = {
  from: dateField.optional(),
  to: dateField.optional(),
  waiterId: z.string().uuid().optional(),
  tableId: z.string().uuid().optional(),
  paymentMethodId: z.string().uuid().optional(),
};

function checkRange(q, ctx) {
  if ((q.from === undefined) !== (q.to === undefined)) {
    ctx.addIssue({
      code: 'custom',
      path: [q.from === undefined ? 'from' : 'to'],
      message: 'Las fechas desde y hasta van juntas',
    });
    return;
  }
  if (q.from === undefined) return;
  if (q.from > q.to) {
    ctx.addIssue({
      code: 'custom',
      path: ['from'],
      message: 'La fecha desde no puede ser posterior a la fecha hasta',
    });
  } else if (daysInRange(q.from, q.to) > MAX_HISTORY_DAYS) {
    ctx.addIssue({
      code: 'custom',
      path: ['to'],
      message: `El rango no puede pasar de ${MAX_HISTORY_DAYS} días`,
    });
  }
}

// GET /history: los filtros mas la paginacion, que llega como texto en la query y se convierte a entero
export const historyQuerySchema = z
  .object({
    ...filters,
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
  .superRefine(checkRange);

// GET /history/export: los mismos filtros y SIN paginacion (page o pageSize tambien son 400: el archivo es todo)
export const historyExportQuerySchema = z.object(filters).strict().superRefine(checkRange);
