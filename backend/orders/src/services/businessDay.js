// El "dia" del cierre de caja es el dia del restaurante, no el del servidor: los contenedores corren en UTC y una
// venta de las 8 p. m. en Neiva ya es del dia siguiente en UTC. Colombia no tiene horario de verano, asi que el
// dia de negocio es UTC-5 todo el ano: el del 14-nov va de 2026-11-14T00:00-05:00 (05:00 UTC) al 15-nov, sin incluirlo.
export const BUSINESS_UTC_OFFSET = '-05:00';

const DAY_MS = 24 * 60 * 60 * 1000;

// Rango [start, end) en instantes UTC del dia `date` (AAAA-MM-DD, ya validada). `end` es exclusivo: un cierre
// justo a medianoche pertenece al dia que empieza, no al que termina.
export function businessDayRange(date) {
  const start = new Date(`${date}T00:00:00${BUSINESS_UTC_OFFSET}`);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

// Dia de negocio (AAAA-MM-DD, Colombia UTC-5) al que pertenece un instante. Es la inversa de businessDayRange:
// un cobro a las 20:00 de Neiva (01:00 UTC del dia siguiente) sigue siendo del dia que termina.
export function businessDateOf(instant) {
  return new Date(instant.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
