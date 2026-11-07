import { api } from './client.js'

export const getOrderDetail = (orderId) => api(`/api/orders/${orderId}`)

export const createRound = (orderId, items) =>
  api(`/api/orders/${orderId}/rounds`, {
    method: 'POST',
    body: { items },
  })

// GC-ORD-0006. La cuenta la calcula el backend (R4): no se envia nada. Pasa la mesa a en_cobro y es
// idempotente si ya lo estaba.
export const getBill = (orderId) => api(`/api/orders/${orderId}/bill`)

export const cancelBill = (orderId) =>
  api(`/api/orders/${orderId}/cancel-bill`, { method: 'POST' })

// R4: sin cuerpo. El backend fija el estado y deliveredAt.
export const deliverItem = (itemId) =>
  api(`/api/orders/items/${itemId}/deliver`, { method: 'PUT' })

// R4: solo viaja el motivo. El backend decide si el rol puede anular en ese estado.
export const cancelItem = (itemId, reason) =>
  api(`/api/orders/items/${itemId}/cancel`, {
    method: 'POST',
    body: { reason },
  })
