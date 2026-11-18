import { expireSession, getAccessToken, refreshSession } from '../auth/session.js'
import { api } from './client.js'
import { ApiError, readBody, toApiError } from './errors.js'

// GC-RPT-0003. Historial de ventas, solo ADMIN. Montos en pesos enteros (R5). Trae ids de meseros y metodos de pago,
// no nombres: se resuelven aparte (como en el cierre de caja). La mesa si viene con su numero (tableNumber).

// Query del historial: solo los filtros con valor. `from`/`to` van juntos (el backend responde 400 con uno solo).
export function historyQuery({ from, to, waiterId, tableId, paymentMethodId } = {}, { page, pageSize } = {}) {
  const params = new URLSearchParams()
  if (from && to) {
    params.set('from', from)
    params.set('to', to)
  }
  if (waiterId) params.set('waiterId', waiterId)
  if (tableId) params.set('tableId', tableId)
  if (paymentMethodId) params.set('paymentMethodId', paymentMethodId)
  if (page) params.set('page', String(page))
  if (pageSize) params.set('pageSize', String(pageSize))
  const query = params.toString()
  return query ? `?${query}` : ''
}

// GET /history: { items, page, pageSize, total, summary }. El resumen es de TODO el filtro, no de la pagina.
export const listSalesHistory = (filters, paging) =>
  api(`/api/orders/history${historyQuery(filters, paging)}`)

// GET /history/{orderId}: la venta con sus lineas (snapshot R3), recibido y cambio. 404 ORDER_NOT_FOUND.
export const getSalesHistoryOrder = (orderId) => api(`/api/orders/history/${encodeURIComponent(orderId)}`)

const NETWORK_ERROR = () => new ApiError(0, 'NETWORK_ERROR', 'No se pudo conectar con el servidor')

function getWithToken(path) {
  const token = getAccessToken()
  return fetch(path, {
    method: 'GET',
    credentials: 'same-origin',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

// Nombre del archivo que manda el servidor en Content-Disposition (attachment; filename="ventas_....xlsx")
export function fileNameFrom(contentDisposition, fallback) {
  const match = /filename="?([^";]+)"?/i.exec(contentDisposition ?? '')
  return match ? match[1] : fallback
}

// GET /history/export: el .xlsx con los filtros activos (sin paginar). Devuelve { blob, fileName }.
// client.js (protegido) siempre lee JSON, asi que la descarga binaria va aqui con la MISMA politica de sesion: con
// 401 renueva la sesion UNA vez y reintenta; si la renovacion es rechazada, la sesion expira. Los errores (400, 403,
// 422 EXPORT_TOO_LARGE) llegan como JSON y se convierten en ApiError igual que en el resto de la app.
export async function downloadSalesHistory(filters) {
  const path = `/api/orders/history/export${historyQuery(filters)}`
  let res
  try {
    res = await getWithToken(path)
  } catch {
    throw NETWORK_ERROR()
  }

  if (res.status === 401) {
    try {
      await refreshSession()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) expireSession()
      throw err instanceof ApiError ? err : NETWORK_ERROR()
    }
    try {
      res = await getWithToken(path)
    } catch {
      throw NETWORK_ERROR()
    }
    if (res.status === 401) expireSession()
  }

  if (!res.ok) throw toApiError(res, await readBody(res))
  const fallback = `ventas_${filters?.from ?? ''}_${filters?.to ?? ''}.xlsx`
  return {
    blob: await res.blob(),
    fileName: fileNameFrom(res.headers.get('content-disposition'), fallback),
  }
}
