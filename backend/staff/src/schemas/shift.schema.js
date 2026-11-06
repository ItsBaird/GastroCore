import { z } from 'zod';

// Fecha y hora con zona (ISO 8601): "2026-11-09T08:00:00-05:00" o "...Z". Sin zona seria ambiguo
// (el servidor no sabe en que hora local lo escribio el cliente), asi que se exige.
const dateTime = (required) =>
  z
    .string({ error: required })
    .datetime({ offset: true, error: 'Debe ser una fecha y hora ISO 8601 con zona horaria' })
    .transform((v) => new Date(v));

const userId = z.uuid('El userId debe ser un UUID valido');

// CreateShiftRequest del contrato. El estado no se envia: el turno siempre nace 'programado'.
// Los campos desconocidos (status, actualStart...) se descartan.
export const createShiftSchema = z
  .object({
    userId,
    scheduledStart: dateTime('La hora de inicio es obligatoria'),
    scheduledEnd: dateTime('La hora de fin es obligatoria'),
  })
  .refine((v) => v.scheduledEnd > v.scheduledStart, {
    path: ['scheduledEnd'],
    error: 'El rango horario no es valido: la hora de fin debe ser posterior a la de inicio',
  });

// Fecha de calendario AAAA-MM-DD que exista de verdad
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La semana debe tener el formato AAAA-MM-DD')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'La fecha de la semana no es valida');

// GET /shifts: ambos filtros son opcionales. `week` es cualquier dia de la semana a consultar.
export const listShiftsQuerySchema = z.object({
  week: calendarDate.optional(),
  userId: userId.optional(),
});
