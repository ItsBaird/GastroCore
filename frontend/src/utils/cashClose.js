const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

// Hoy como AAAA-MM-DD en la hora LOCAL del navegador. toISOString() daria el dia UTC: a las 7 p. m. en Colombia
// ya es el dia siguiente en UTC y el cierre se pediria del dia equivocado.
export function todayLocal(now = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

// Un dia real del calendario (el input type=date entrega '' al borrarlo). El servidor vuelve a validar.
export function isValidDay(value) {
  if (typeof value !== 'string' || !DAY_RE.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

// '2026-11-14' -> '14 de noviembre de 2026'. Es una fecha de calendario: se formatea en UTC para que no se corra un dia.
export function formatLongDate(value) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

// Nombre de un id usando una lista [{ [idKey]: id, [nameKey]: nombre }]; `fallback` si no aparece
export function nameOf(list, idKey, nameKey, id, fallback) {
  return list.find((item) => item[idKey] === id)?.[nameKey] ?? fallback
}

// '2026-11-14' -> '14/11/2026' (fecha de calendario de una tabla; sin conversion de zona)
export function formatShortDate(value) {
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year}`
}

// Instante ISO -> '14 nov 2026, 6:30 p. m.' en la hora local del navegador (cuando se confirmo el cierre)
export function formatDateTime(iso) {
  return new Date(iso).toLocaleString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// Un dia que todavia no empieza (hora local): el servidor tampoco lo deja cerrar
export function isFutureDay(value, now = new Date()) {
  return value > todayLocal(now)
}
