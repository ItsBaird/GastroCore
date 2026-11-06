import { ApiError } from '../api/errors.js'

// Mismas reglas que el backend (zod): el servidor siempre vuelve a validar
export function validatePaymentMethod({ name }) {
  const errors = {}
  if (!name.trim()) errors.name = 'El nombre es obligatorio'
  else if (name.trim().length > 50) errors.name = 'Admite hasta 50 caracteres'
  return errors
}

// Convierte un error de la API en { fields: { campo: mensaje }, general }
export function mapPaymentMethodError(err) {
  if (!(err instanceof ApiError)) return { general: 'No se pudo completar la acción.' }
  if (err.code === 'CONFLICT') return { fields: { name: 'Ya existe un método de pago con ese nombre' } }
  if (err.code === 'VALIDATION_ERROR' && err.details?.fields?.length) {
    const fields = {}
    err.details.fields.forEach((f) => {
      if (f.path) fields[f.path] = f.message
    })
    return Object.keys(fields).length ? { fields } : { general: err.message }
  }
  if (err.code === 'NOT_FOUND') return { general: 'Este método ya no existe. Actualiza la lista.' }
  if (err.code === 'FORBIDDEN') return { general: err.message }
  if (err.code === 'NETWORK_ERROR') return { general: 'No se pudo conectar con el servidor.' }
  return { general: 'No se pudo completar la acción. Inténtalo de nuevo.' }
}
