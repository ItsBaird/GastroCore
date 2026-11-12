// GC-QR-0001. Cliente HTTP del canal publico del QR (el cliente del restaurante no inicia sesion).
// No usa client.js a proposito: ese adjunta el access token y reintenta con la cookie de refresh. Aqui:
//   - credentials: 'omit' -> nunca viaja la cookie de sesion (aunque el celular sea de un mesero)
//   - sin Authorization
//   - timeout amplio: en el plan gratuito de Render un servicio dormido tarda hasta ~1 min en despertar
// El token del QR solo viaja en la ruta; nunca se guarda ni se registra.

const TIMEOUT_MS = 60_000

export class QrApiError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'QrApiError'
    this.status = status // 0 = sin conexion o tiempo agotado
    this.code = code
  }
}

async function request(path, { method = 'GET', signal } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort)
  try {
    let res
    try {
      res = await fetch(path, {
        method,
        credentials: 'omit',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })
    } catch (err) {
      if (signal?.aborted) throw err
      throw new QrApiError(0, 'NETWORK_ERROR', 'Sin conexión')
    }
    const text = await res.text()
    let body = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      // cuerpo no JSON (p. ej. una pagina de error del proxy)
    }
    if (!res.ok) {
      throw new QrApiError(
        res.status,
        body?.error?.code ?? 'UNKNOWN',
        body?.error?.message ?? 'Error inesperado',
      )
    }
    return body
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

const tokenPath = (qrToken) => `/api/orders/qr/${encodeURIComponent(qrToken)}`

// Estado de la mesa y capacidades (QrTable): lo decide el backend
export const getQrTable = (qrToken, options) => request(tokenPath(qrToken), options)

// Menu publico de Catalog (R2: se pide a Catalog, no a Orders)
export const getPublicMenu = (options) => request('/api/catalog/public/menu', options)

// GC-QR-0002 (backend de Oscar). Sin cuerpo: el cliente no elige mesa ni tipo
export const callWaiter = (qrToken) => request(`${tokenPath(qrToken)}/call`, { method: 'POST' })
