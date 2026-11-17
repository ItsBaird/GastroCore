import { z } from 'zod';

// Es un dia real del calendario: 2026-02-30 o 2026-13-01 no existen. Zod ejecuta esta comprobacion aunque el
// formato ya haya fallado (por ejemplo "ayer"), y `toISOString()` lanza con una fecha invalida: sin proteger eso,
// una fecha mal escrita daria 500 en lugar de 400.
function isRealCalendarDay(value) {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// `date` es obligatoria y con el formato AAAA-MM-DD (2026-1-5 es 400). Cualquier otro parametro tambien es 400:
// un filtro que no existe no se ignora en silencio.
const dateField = z
  .string({ error: 'La fecha es obligatoria (AAAA-MM-DD)' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener el formato AAAA-MM-DD')
  .refine(isRealCalendarDay, { message: 'La fecha no existe en el calendario' });

export const cashCloseQuerySchema = z.object({ date: dateField }).strict();

// POST (GC-RPT-0002): la fecha viaja en el cuerpo y no se aceptan campos extra. El cliente nunca envia totales
// (R4): el consolidado lo calcula el servidor.
export const cashCloseBodySchema = z.object({ date: dateField }).strict();
