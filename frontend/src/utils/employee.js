import { ApiError } from '../api/errors.js'

// Sugerencias para el campo cargo (texto libre, hasta 50 caracteres)
export const POSITION_SUGGESTIONS = ['Administrador', 'Mesero', 'Cocinero', 'Cajero', 'Auxiliar de cocina']

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isRealDate(value) {
  if (!DATE_RE.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

// Mismas reglas que el backend (zod): el servidor siempre vuelve a validar
export function validateEmployee(values, { needsUser }) {
  const errors = {}
  if (needsUser && !values.userId) errors.userId = 'Selecciona un usuario'
  if (!values.fullName.trim()) errors.fullName = 'El nombre es obligatorio'
  else if (values.fullName.trim().length > 150) errors.fullName = 'Admite hasta 150 caracteres'
  if (!values.documentNumber.trim()) errors.documentNumber = 'El documento es obligatorio'
  else if (values.documentNumber.trim().length > 30) errors.documentNumber = 'Admite hasta 30 caracteres'
  if (!values.position.trim()) errors.position = 'El cargo es obligatorio'
  else if (values.position.trim().length > 50) errors.position = 'Admite hasta 50 caracteres'
  if (values.phone.trim().length > 30) errors.phone = 'Admite hasta 30 caracteres'
  if (!values.hireDate) errors.hireDate = 'La fecha de ingreso es obligatoria'
  else if (!isRealDate(values.hireDate)) errors.hireDate = 'La fecha de ingreso no es válida'
  return errors
}

// '2026-03-15' -> '15 mar 2026'. Es una fecha de calendario: se formatea en UTC para que no se corra un dia.
const DATE_FORMAT = new Intl.DateTimeFormat('es-CO', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})
export function formatHireDate(value) {
  if (!isRealDate(value)) return value ?? ''
  const part = Object.fromEntries(
    DATE_FORMAT.formatToParts(new Date(`${value}T00:00:00Z`)).map((p) => [p.type, p.value]),
  )
  return `${part.day} ${part.month.replace('.', '')} ${part.year}`
}

export const todayISO = () => new Date().toISOString().slice(0, 10)

// Convierte un error de la API en { fields: { campo: mensaje }, general }
export function mapEmployeeError(err) {
  if (!(err instanceof ApiError)) return { general: 'No se pudo completar la acción.' }
  if (err.code === 'CONFLICT') {
    return err.details?.field === 'userId'
      ? { fields: { userId: 'Este usuario ya tiene un perfil de empleado' } }
      : { fields: { documentNumber: 'Este número de documento ya está registrado' } }
  }
  if (err.code === 'VALIDATION_ERROR' && err.details?.fields?.length) {
    const fields = {}
    err.details.fields.forEach((f) => {
      if (f.path) fields[f.path] = f.message
    })
    return Object.keys(fields).length ? { fields } : { general: err.message }
  }
  if (err.code === 'NOT_FOUND') return { general: 'Este empleado ya no existe. Actualiza la lista.' }
  if (err.code === 'DEPENDENCY_UNAVAILABLE') {
    return { general: 'No se pudo verificar el usuario en Auth. Inténtalo de nuevo en un momento.' }
  }
  if (err.code === 'FORBIDDEN') return { general: err.message }
  if (err.code === 'NETWORK_ERROR') return { general: 'No se pudo conectar con el servidor.' }
  return { general: 'No se pudo completar la acción. Inténtalo de nuevo.' }
}
