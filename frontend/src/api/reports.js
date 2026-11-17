import { api } from './client.js'

// GC-RPT-0001. Solo lectura, solo ADMIN. `date` es AAAA-MM-DD, el dia del restaurante (hora de Colombia).
// Un dia sin ordenes cerradas no es un error: responde ceros y listas vacias.
// Trae ids, no nombres: los de metodos de pago y meseros se resuelven aparte.
export const getCashClosePreview = (date) =>
  api(`/api/orders/reports/cash-close?date=${encodeURIComponent(date)}`)

// GC-RPT-0002 (GC-158). Solo ADMIN. Historial paginado de cierres confirmados (solo resumen).
export const listCashClosures = ({ page = 1, pageSize = 10 } = {}) =>
  api(`/api/orders/reports/cash-closures?page=${page}&pageSize=${pageSize}`)

// El cierre CONFIRMADO de un dia (snapshot). 404 = ese dia todavia no se ha cerrado.
export const getCashClosure = (date) => api(`/api/orders/reports/cash-closures/${encodeURIComponent(date)}`)

// Confirma el cierre del dia. El cliente solo manda la fecha: el consolidado lo calcula el servidor (R4).
// 409 DAY_CLOSED si ya estaba cerrado; 400 si el dia aun no empieza.
export const confirmCashClose = (date) =>
  api('/api/orders/reports/cash-close', { method: 'POST', body: { date } })
