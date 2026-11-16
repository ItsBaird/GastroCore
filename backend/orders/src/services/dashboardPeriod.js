import { BUSINESS_UTC_OFFSET, businessDayRange } from './businessDay.js';

// GC-RPT-0004. Periodos del dashboard en dias de negocio (Colombia, UTC-5 todo el ano; ver businessDay.js).
// Funciones puras: el reloj llega por parametro, nunca se usa la zona del servidor.
export const MAX_DAYS = 92;

const DAY_MS = 24 * 60 * 60 * 1000;
// '-05:00' -> -5 h en milisegundos: el mismo desfase con el que Oscar define el dia del cierre de caja
const [, sign, hh, mm] = /^([+-])(\d{2}):(\d{2})$/.exec(BUSINESS_UTC_OFFSET);
const OFFSET_MS = (sign === '-' ? -1 : 1) * (Number(hh) * 60 + Number(mm)) * 60 * 1000;

const atUtcMidnight = (day) => new Date(`${day}T00:00:00Z`);
const toDay = (date) => date.toISOString().slice(0, 10);

export const addDays = (day, n) => toDay(new Date(atUtcMidnight(day).getTime() + n * DAY_MS));

// Dias de `from` a `to`, ambos incluidos (2026-11-10..2026-11-10 es 1 dia)
export const daysInclusive = (from, to) =>
  Math.round((atUtcMidnight(to) - atUtcMidnight(from)) / DAY_MS) + 1;

// El dia de negocio de un instante: a las 23:30 de Neiva ya son las 04:30 UTC del dia siguiente
export const businessDayOf = (instant) => toDay(new Date(instant.getTime() + OFFSET_MS));

// Semana en curso de lunes a domingo, en dias de negocio. El domingo es el ultimo dia de la semana.
export function currentWeek(now = new Date()) {
  const today = businessDayOf(now);
  const daysSinceMonday = (atUtcMidnight(today).getUTCDay() + 6) % 7;
  const from = addDays(today, -daysSinceMonday);
  return { from, to: addDays(from, 6) };
}

// Periodo pedido (o la semana en curso) y el anterior de igual duracion, que termina el dia previo a `from`
export function resolvePeriods({ from, to } = {}, now = new Date()) {
  const period = from && to ? { from, to } : currentWeek(now);
  const days = daysInclusive(period.from, period.to);
  return {
    period,
    previousPeriod: { from: addDays(period.from, -days), to: addDays(period.from, -1) },
  };
}

// Instantes UTC [start, end) del periodo: del inicio del primer dia al fin del ultimo (exclusivo)
export function periodRange({ from, to }) {
  return { start: businessDayRange(from).start, end: businessDayRange(to).end };
}

// Todos los dias del periodo, en orden
export function listDays({ from, to }) {
  return Array.from({ length: daysInclusive(from, to) }, (_, i) => addDays(from, i));
}
