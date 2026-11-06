import { ApiError } from '../api/errors.js'

// El restaurante opera en hora de Colombia (UTC-5, sin horario de verano). Las semanas y los
// horarios se muestran y se envian en esa zona, igual que las calcula el backend de Staff.
export const TIMEZONE = 'America/Bogota'
const OFFSET = '-05:00'
const DAY_MS = 86_400_000

export const STATUS_LABEL = { programado: 'Programado', activo: 'Activo', finalizado: 'Finalizado' }
export const STATUS_CLASS = {
  programado: 'pill--scheduled',
  activo: 'pill--active',
  finalizado: 'pill--done',
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const utc = (date) => new Date(`${date}T00:00:00Z`)
const iso = (ms) => new Date(ms).toISOString().slice(0, 10)

// AAAA-MM-DD de un instante, en hora de Colombia
const DAY_KEY = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
export const dayKey = (value) => DAY_KEY.format(new Date(value))
export const todayKey = () => dayKey(Date.now())

export const addDays = (date, days) => iso(utc(date).getTime() + days * DAY_MS)

// Lunes de la semana de `date` (la semana va de lunes a domingo)
export function mondayOf(date) {
  const sinceMonday = (utc(date).getUTCDay() + 6) % 7
  return addDays(date, -sinceMonday)
}

export const weekDays = (monday) => Array.from({ length: 7 }, (_, i) => addDays(monday, i))

function parts(formatter, date) {
  return Object.fromEntries(formatter.formatToParts(utc(date)).map((p) => [p.type, p.value]))
}
const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1)
const HEADING = new Intl.DateTimeFormat('es-CO', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
})
const SHORT = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const YEAR = new Intl.DateTimeFormat('es-CO', { year: 'numeric', timeZone: 'UTC' })

// "Lunes 9 de noviembre"
export function formatDayHeading(date) {
  const p = parts(HEADING, date)
  return `${cap(p.weekday)} ${p.day} de ${p.month}`
}

// "2 nov – 8 nov 2026"
export function formatWeekRange(monday) {
  const short = (d) => {
    const p = parts(SHORT, d)
    return `${p.day} ${p.month.replace('.', '')}`
  }
  const sunday = addDays(monday, 6)
  return `${short(monday)} – ${short(sunday)} ${parts(YEAR, sunday).year}`
}

const TIME = new Intl.DateTimeFormat('es-CO', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: TIMEZONE,
})
// "8:00 a. m."
export const formatTime = (value) => TIME.format(new Date(value)).replace(/\s/g, ' ')

// "8h 00m"
export function formatDuration(start, end) {
  const minutes = Math.round((new Date(end) - new Date(start)) / 60_000)
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

// Fecha + hora (de reloj, en Colombia) -> ISO 8601 con zona: "2026-11-09T08:00:00-05:00"
export const toIso = (date, time) => `${date}T${time}:00${OFFSET}`

function isRealDate(value) {
  if (!DATE_RE.test(value)) return false
  return iso(utc(value).getTime()) === value
}

// Mismas reglas que el backend: el servidor siempre vuelve a validar
export function validateShift({ userId, date, start, end }) {
  const errors = {}
  if (!userId) errors.userId = 'Selecciona un empleado'
  if (!date) errors.date = 'La fecha es obligatoria'
  else if (!isRealDate(date)) errors.date = 'La fecha no es válida'
  if (!start) errors.start = 'La hora de inicio es obligatoria'
  if (!end) errors.end = 'La hora de fin es obligatoria'
  else if (start && end <= start) {
    errors.end = 'El rango horario no es válido: la hora de fin debe ser posterior a la de inicio'
  }
  return errors
}

// Los campos del servidor no se llaman igual que los del formulario
const FIELD_MAP = { userId: 'userId', scheduledStart: 'start', scheduledEnd: 'end' }

// Convierte un error de la API en { fields: { campo: mensaje }, general }
export function mapShiftError(err) {
  if (!(err instanceof ApiError)) return { general: 'No se pudo completar la acción.' }
  if (err.code === 'VALIDATION_ERROR' && err.details?.fields?.length) {
    const fields = {}
    err.details.fields.forEach((f) => {
      const key = FIELD_MAP[f.path]
      if (key) fields[key] = f.message
    })
    return Object.keys(fields).length ? { fields } : { general: err.message }
  }
  if (err.code === 'NOT_FOUND')
    return { fields: { userId: 'Este empleado ya no existe. Actualiza la lista.' } }
  if (err.code === 'FORBIDDEN') return { general: err.message }
  if (err.code === 'NETWORK_ERROR') return { general: 'No se pudo conectar con el servidor.' }
  return { general: 'No se pudo completar la acción. Inténtalo de nuevo.' }
}

const byStart = (a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart)

// Que turno mostrarle al empleado ahora: el activo (si lo hay); si no, el programado de hoy (de preferencia
// uno que aun no termino); si no, el ya finalizado de hoy; si no, el proximo de la semana. `shifts` son
// los suyos (GET /shifts?userId=). Devuelve { kind: 'activo'|'programado'|'finalizado'|'proximo'|'ninguno', shift }.
export function pickCurrentShift(shifts, now = Date.now(), today = todayKey()) {
  const active = shifts.find((s) => s.status === 'activo')
  if (active) return { kind: 'activo', shift: active }

  const todays = shifts.filter((s) => dayKey(s.scheduledStart) === today).sort(byStart)
  const scheduled = todays.filter((s) => s.status === 'programado')
  const pending = scheduled.find((s) => new Date(s.scheduledEnd) > now) ?? scheduled.at(-1)
  if (pending) return { kind: 'programado', shift: pending }

  const finished = todays.filter((s) => s.status === 'finalizado').at(-1)
  if (finished) return { kind: 'finalizado', shift: finished }

  const next = shifts
    .filter((s) => s.status === 'programado' && new Date(s.scheduledStart) > now)
    .sort(byStart)[0]
  return next ? { kind: 'proximo', shift: next } : { kind: 'ninguno', shift: null }
}

// Mensaje para el usuario cuando falla iniciar/finalizar un turno. `refresh` indica que conviene
// volver a pedir el turno porque cambio de estado. `own` es false cuando un ADMIN actua sobre otro empleado.
export function shiftActionMessage(err, { own = true } = {}) {
  if (!(err instanceof ApiError)) return { message: 'No se pudo completar la acción.' }
  const d = err.details ?? {}
  if (err.code === 'INVALID_TRANSITION') {
    // La hora ya termina en punto ("8:00 a. m."): se cuida no duplicarlo al cerrar la frase
    if (d.reason === 'BEFORE_START') {
      const at = formatTime(d.scheduledStart)
      return {
        message: `Todavía no es la hora de tu turno. Empieza hoy a las ${at}${at.endsWith('.') ? '' : '.'}`,
      }
    }
    if (d.reason === 'AFTER_END') {
      return {
        message: `Tu turno programado ya terminó (a las ${formatTime(d.scheduledEnd)}). Habla con el administrador.`,
      }
    }
    return { message: 'Este turno ya cambió de estado. Se actualizó la información.', refresh: true }
  }
  if (err.code === 'HAS_OPEN_TABLES') {
    const n = d.count ?? 0
    const tables = n === 1 ? '1 mesa abierta' : `${n} mesas abiertas`
    return {
      message: own
        ? `Tienes ${tables}. El administrador debe reasignarlas antes de que puedas finalizar el turno.`
        : `El empleado tiene ${tables}. Reasígnalas antes de finalizar su turno.`,
    }
  }
  if (err.code === 'DEPENDENCY_UNAVAILABLE') {
    return { message: 'No se pudo verificar las mesas abiertas. Inténtalo de nuevo en un momento.' }
  }
  if (err.code === 'NOT_FOUND') return { message: 'Este turno ya no existe.', refresh: true }
  if (err.code === 'FORBIDDEN') return { message: err.message }
  if (err.code === 'NETWORK_ERROR') return { message: 'No se pudo conectar con el servidor.' }
  return { message: 'No se pudo completar la acción. Inténtalo de nuevo.' }
}
