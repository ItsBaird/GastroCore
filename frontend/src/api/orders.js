import { api } from './client.js'

export const getOrderDetail = (orderId) => api(`/api/orders/${orderId}`)

export const createRound = (orderId, items) =>
  api(`/api/orders/${orderId}/rounds`, {
    method: 'POST',
    body: { items },
  })

// GC-ORD-0006. La cuenta la calcula el backend (R4): no se envia nada.
// getBill solo lee; startBilling pasa la mesa a en_cobro (idempotente si ya lo estaba) y devuelve la cuenta.
export const getBill = (orderId) => api(`/api/orders/${orderId}/bill`)

export const startBilling = (orderId) =>
  api(`/api/orders/${orderId}/start-billing`, { method: 'POST' })

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

// GC-ORD-0007. R4: solo el monto (pesos enteros; 0 quita el descuento) y un motivo opcional. Devuelve la
// cuenta recalculada por el backend.
export const applyDiscount = (orderId, { discountAmount, reason }) =>
  api(`/api/orders/${orderId}/discount`, {
    method: 'POST',
    body: { discountAmount, ...(reason && { reason }) },
  })

// GC-ORD-0008. R4: solo viajan el metodo y, con efectivo, lo que entrego el cliente (pesos enteros). El total,
// el cambio y el cierre los decide el backend; devuelve el Payment (con changeGiven) y la orden queda CERRADA.
export const registerPayment = (orderId, { paymentMethodId, amountReceived }) =>
  api(`/api/orders/${orderId}/pay`, {
    method: 'POST',
    body: { paymentMethodId, ...(amountReceived !== undefined && { amountReceived }) },
  })
