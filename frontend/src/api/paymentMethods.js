import { api } from './client.js'

// El admin ve todos (activos e inactivos). El mesero, al cobrar, pide solo los activos: ?active=true
export function listPaymentMethods({ active } = {}) {
  const query = active === undefined ? '' : `?active=${active}`
  return api(`/api/orders/payment-methods${query}`)
}

// isCash e isActive son opcionales: al crear valen false y true
export const createPaymentMethod = (values) =>
  api('/api/orders/payment-methods', { method: 'POST', body: values })

// El nombre es obligatorio en cada PUT. Lo que no se envia (isCash, isActive) queda como esta.
// Desactivar = enviar { name, isActive: false }: el metodo se conserva en los registros historicos.
export const updatePaymentMethod = (id, changes) =>
  api(`/api/orders/payment-methods/${id}`, { method: 'PUT', body: changes })
