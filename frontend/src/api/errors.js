// Error de la API con el formato comun { error: { code, message, details } }
export class ApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export async function readBody(res) {
  if (res.status === 204) return null
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function toApiError(res, body) {
  return new ApiError(
    res.status,
    body?.error?.code ?? 'UNKNOWN',
    body?.error?.message ?? 'Error inesperado',
    body?.error?.details ?? {},
  )
}
