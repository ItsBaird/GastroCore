import { api } from './client.js'

export const getOrderDetail = (orderId) => api(`/api/orders/${orderId}`)

export const createRound = (orderId, items) =>
  api(`/api/orders/${orderId}/rounds`, {
    method: 'POST',
    body: { items },
  })

// R4: sin cuerpo. El backend fija el estado y deliveredAt.
export const deliverItem = (itemId) =>
  api(`/api/orders/items/${itemId}/deliver`, { method: 'PUT' })

// R4: solo viaja el motivo. El backend decide si el rol puede anular en ese estado.
export const cancelItem = (itemId, reason) =>
  api(`/api/orders/items/${itemId}/cancel`, {
    method: 'POST',
    body: { reason },
  })
