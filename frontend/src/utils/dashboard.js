// GC-RPT-0004. Utilidades puras del dashboard. Las fechas son dias de negocio de Colombia: "hoy" y "esta semana" se
// calculan en America/Bogota, no en la zona del navegador (el admin puede estar de viaje). Una fecha AAAA-MM-DD es
// un dia de calendario: se manipula y se formatea en UTC para que no se corra un dia.

export const MAX_DAYS = 92
export const BUSINESS_TZ = 'America/Bogota'
const DAY_MS = 24 * 60 * 60 * 1000
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

const atUtc = (day) => new Date(`${day}T00:00:00Z`)
const toDay = (date) => date.toISOString().slice(0, 10)

// Hoy en Colombia como AAAA-MM-DD (en-CA da justo ese formato)
export function businessToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export const addDays = (day, n) => toDay(new Date(atUtc(day).getTime() + n * DAY_MS))
export const daysInclusive = (from, to) => Math.round((atUtc(to) - atUtc(from)) / DAY_MS) + 1

export function isValidDay(value) {
  if (typeof value !== 'string' || !DAY_RE.test(value)) return false
  const d = atUtc(value)
  return !Number.isNaN(d.getTime()) && toDay(d) === value
}

// Lunes a domingo de la semana de `day`
export function weekOf(day) {
  const from = addDays(day, -((atUtc(day).getUTCDay() + 6) % 7))
  return { from, to: addDays(from, 6) }
}

// Accesos rapidos. La semana y el mes en curso incluyen los dias que faltan (salen en cero), como el defecto del
// backend; los ultimos 30 dias terminan hoy.
export const PRESETS = [
  { id: 'week', label: 'Esta semana', range: (today) => weekOf(today) },
  { id: 'lastWeek', label: 'Semana pasada', range: (today) => weekOf(addDays(today, -7)) },
  { id: 'last30', label: 'Últimos 30 días', range: (today) => ({ from: addDays(today, -29), to: today }) },
  {
    id: 'month',
    label: 'Este mes',
    range: (today) => {
      const from = `${today.slice(0, 7)}-01`
      const next = atUtc(from)
      next.setUTCMonth(next.getUTCMonth() + 1)
      return { from, to: addDays(toDay(next), -1) }
    },
  },
]

// Mismas reglas que el servidor, para no llamarlo con un rango que va a rechazar. '' si es valido.
export function validateRange(from, to) {
  if (!from || !to) return 'Elige la fecha de inicio y la de fin.'
  if (!isValidDay(from) || !isValidDay(to)) return 'Alguna de las fechas no es válida.'
  if (from > to) return 'La fecha final no puede ser anterior a la inicial.'
  if (daysInclusive(from, to) > MAX_DAYS) return `El rango máximo es de ${MAX_DAYS} días.`
  return ''
}

// ---------- Formatos es-CO ----------

// es-CO escribe "10 de nov." en las fechas cortas: el mes se pide aparte y se compone "10 nov"
const monthShort = new Intl.DateTimeFormat('es-CO', { month: 'short', timeZone: 'UTC' })
const weekday = new Intl.DateTimeFormat('es-CO', { weekday: 'short', timeZone: 'UTC' })
const oneDecimal = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const integer = new Intl.NumberFormat('es-CO')

// "nov." -> "nov": las abreviaturas de Intl traen punto; en una etiqueta sobra
const clean = (text) => text.replace(/\./g, '')
const dayNumber = (day) => Number(day.slice(8))
const year = (day) => day.slice(0, 4)

export const formatShortDate = (day) => `${dayNumber(day)} ${clean(monthShort.format(atUtc(day)))}`
export const formatWeekday = (day) => clean(weekday.format(atUtc(day)))
const withYear = (day) => `${formatShortDate(day)} ${year(day)}`

// "10–16 nov 2026", "28 oct – 3 nov 2026", "28 dic 2026 – 3 ene 2027", "10 nov 2026"
export function formatRange({ from, to }) {
  if (from === to) return withYear(from)
  if (year(from) !== year(to)) return `${withYear(from)} – ${withYear(to)}`
  if (from.slice(5, 7) !== to.slice(5, 7)) return `${formatShortDate(from)} – ${withYear(to)}`
  return `${dayNumber(from)}–${withYear(to)}`
}

export const formatCount = (value) => integer.format(value)
export const formatMinutes = (value) => `${oneDecimal.format(value)} min`

// "+8,2 %", "−3,1 %", "0,0 %". El signo menos es tipografico (U+2212)
export function formatPercent(value) {
  const text = oneDecimal.format(Math.abs(value))
  if (value > 0) return `+${text} %`
  if (value < 0) return `−${text} %`
  return `${text} %`
}

// Porcentaje de una parte sobre el total, con un decimal; 0 si el total es 0
export const share = (part, total) => (total > 0 ? Math.round((part / total) * 1000) / 10 : 0)
export const formatShare = (part, total) => `${oneDecimal.format(share(part, total))} %`

// 13 -> "1 p. m.", 0 -> "12 a. m."
export function formatHour(hour) {
  const h = hour % 12 === 0 ? 12 : hour % 12
  return `${h} ${hour < 12 ? 'a. m.' : 'p. m.'}`
}

// "1:00–2:00 p. m.", "11:00 a. m.–12:00 p. m."
export function formatHourSlot(hour) {
  const start = formatHour(hour)
  const end = formatHour((hour + 1) % 24)
  const [startH, startPeriod] = [start.split(' ')[0], start.slice(start.indexOf(' ') + 1)]
  const [endH, endPeriod] = [end.split(' ')[0], end.slice(end.indexOf(' ') + 1)]
  return startPeriod === endPeriod
    ? `${startH}:00–${endH}:00 ${endPeriod}`
    : `${startH}:00 ${startPeriod}–${endH}:00 ${endPeriod}`
}

// ---------- Lectura de los KPI ----------

// El color dice si el cambio es bueno o malo, no si sube o baja: en preparacion, bajar es bueno.
// null (sin periodo anterior) y 0 son neutros.
export function deltaTone(changePercent, { lowerIsBetter = false } = {}) {
  if (changePercent === null || changePercent === 0) return 'neutral'
  const up = changePercent > 0
  return up !== lowerIsBetter ? 'good' : 'bad'
}

// Dias de la semana/periodo que aun no pasan (incluye hoy si el periodo termina despues de hoy)
export function remainingDays({ from, to }, today) {
  if (today >= to) return 0
  if (today < from) return daysInclusive(from, to)
  return daysInclusive(today, to) - 1
}

// ---------- Escalas ----------

// Escala desde 0 con 4-5 marcas redondas y la ultima por encima del maximo (1, 2, 2,5 o 5 x 10^n)
export function niceScale(max, targetTicks = 4) {
  if (!(max > 0)) return { max: 1, ticks: [0] }
  const rough = max / targetTicks
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough)
  const top = Math.ceil(max / step) * step
  const ticks = []
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000)
  return { max: top, ticks }
}

// Altura relativa de una barra (0-100), nunca negativa ni NaN
export const barPercent = (value, max) => (max > 0 && value > 0 ? Math.min(100, (value / max) * 100) : 0)

// Indices a rotular en un eje de `count` categorias: como mucho `maxLabels`, en un paso que llegue al ultimo
export function labelStep(count, maxLabels = 8) {
  if (count <= maxLabels) return 1
  return Math.ceil((count - 1) / (maxLabels - 1))
}

// Montos compactos para los ejes: 1.250.000 -> "$1,3 M", 85.000 -> "$85 mil"
export function formatCompactCOP(value) {
  if (value >= 1_000_000) return `$${oneDecimal.format(value / 1_000_000).replace(/,0$/, '')} M`
  if (value >= 1000) return `$${integer.format(Math.round(value / 1000))} mil`
  return `$${integer.format(value)}`
}
