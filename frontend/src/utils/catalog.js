import { ApiError } from '../api/errors.js'

export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024

// COP entero, sin decimales (R5)
const COP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
})
export const formatCop = (value) => COP.format(value).replace(/\s/g, '')

// Mismas reglas que el servidor para dar aviso temprano; el backend siempre vuelve a validar
export function validatePhoto(file) {
  if (!PHOTO_TYPES.includes(file.type)) return 'La foto debe ser JPG, PNG o WebP'
  if (file.size > MAX_PHOTO_BYTES) return 'La foto no puede superar 2 MB'
  return undefined
}

// Convierte un error de la API en { fields: { campo: mensaje }, general }
export function mapCatalogError(err, { conflict }) {
  if (!(err instanceof ApiError)) return { general: 'No se pudo completar la acción.' }
  if (err.code === 'CONFLICT') return { fields: { name: conflict } }
  if (err.code === 'VALIDATION_ERROR' && err.details?.fields?.length) {
    const fields = {}
    err.details.fields.forEach((f) => {
      if (f.path) fields[f.path] = f.message
    })
    return Object.keys(fields).length ? { fields } : { general: err.message }
  }
  if (err.code === 'NOT_FOUND') return { general: 'Este elemento ya no existe. Actualiza la lista.' }
  if (err.code === 'FORBIDDEN') return { general: err.message }
  if (err.code === 'NETWORK_ERROR') return { general: 'No se pudo conectar con el servidor.' }
  return { general: 'No se pudo completar la acción. Inténtalo de nuevo.' }
}
