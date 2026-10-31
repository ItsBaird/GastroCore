import { api } from './client.js'

export const getOrderDetail = (orderId) => api(`/api/orders/${orderId}`)

export const createRound = (orderId, items) =>
  api(`/api/orders/${orderId}/rounds`, {
    method: 'POST',
    body: { items },
  })
