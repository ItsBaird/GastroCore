// Semana laboral del restaurante: de lunes 00:00 a domingo 24:00 en hora de Colombia.
// Colombia no tiene horario de verano, asi que el desfase es fijo: UTC-5. Se calcula aqui (y no con
// la zona del servidor o de la base) para que un turno de domingo a las 9 p. m. no caiga en la semana siguiente.
const COLOMBIA_OFFSET_HOURS = -5;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// `date` es una fecha de calendario AAAA-MM-DD (cualquier dia de la semana). Devuelve el rango
// [start, end) en UTC: start = lunes 00:00 hora Colombia, end = lunes siguiente 00:00.
export function weekRange(date) {
  const [y, m, d] = date.split('-').map(Number);
  const dayUtc = Date.UTC(y, m - 1, d);
  const daysSinceMonday = (new Date(dayUtc).getUTCDay() + 6) % 7; // lunes=0 ... domingo=6
  const start = new Date(dayUtc - daysSinceMonday * DAY_MS - COLOMBIA_OFFSET_HOURS * HOUR_MS);
  return { start, end: new Date(start.getTime() + 7 * DAY_MS) };
}
