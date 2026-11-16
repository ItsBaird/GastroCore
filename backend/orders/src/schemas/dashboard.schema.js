import { z } from 'zod';
import { daysInclusive, MAX_DAYS } from '../services/dashboardPeriod.js';
import { cashCloseQuerySchema } from './cashClose.schema.js';

// La misma regla de fecha del cierre de caja (formato AAAA-MM-DD y dia real del calendario), sin copiarla
const day = cashCloseQuerySchema.shape.date;
const isDay = (value) => day.safeParse(value).success;

// GC-RPT-0004. `from` y `to` juntos o ninguno (sin ellos, la semana en curso). Rango con ambos extremos
// incluidos y de hasta 92 dias. Cualquier otro parametro es 400 (.strict()).
// Zod 4 ejecuta superRefine aunque un campo ya haya fallado: las reglas del rango solo miran fechas validas
// para no sumar un segundo error ni calcular con una fecha mal escrita.
export const dashboardQuerySchema = z
  .object({ from: day.optional(), to: day.optional() })
  .strict()
  .superRefine(({ from, to }, ctx) => {
    if ((from === undefined) !== (to === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: [from === undefined ? 'from' : 'to'],
        message: 'Indica las dos fechas del periodo (desde y hasta) o ninguna',
      });
      return;
    }
    if (from === undefined || !isDay(from) || !isDay(to)) return;
    if (from > to) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'La fecha final no puede ser anterior a la inicial',
      });
    } else if (daysInclusive(from, to) > MAX_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: `El rango máximo es de ${MAX_DAYS} días`,
      });
    }
  });
