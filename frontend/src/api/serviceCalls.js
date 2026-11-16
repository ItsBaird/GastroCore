import { api } from './client.js'

// GC-QR-0002 (endpoint de Oscar). El mesero marca como atendido un llamado pendiente (call_waiter o
// request_bill). Sin cuerpo. 409 INVALID_TRANSITION si ya estaba atendido, 403 si la mesa es de otro mesero,
// 404 si no existe. Responde el ServiceCall atendido.
export const attendServiceCall = (serviceCallId) =>
  api(`/api/orders/service-calls/${encodeURIComponent(serviceCallId)}/attend`, { method: 'PUT' })
