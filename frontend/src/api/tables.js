import { api } from './client.js'

export const listTables = () => api('/api/orders/tables')

export const createTable = ({ tableNumber }) =>
  api('/api/orders/tables', { method: 'POST', body: { tableNumber } })

// Solo cambia el numero de mesa; el qrToken es inmutable (GC-ADM-0002)
export const updateTable = (tableId, { tableNumber }) =>
  api(`/api/orders/tables/${tableId}`, { method: 'PUT', body: { tableNumber } })

// Solo cambia quien atiende la mesa; quien la abrio se conserva para la atribucion de ventas
export const reassignTable = (tableId, waiterId) =>
  api(`/api/orders/tables/${tableId}/reassign`, { method: 'PUT', body: { waiterId } })
