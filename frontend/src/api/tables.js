import { api } from './client.js'

export const listTables = () => api('/api/orders/tables')

export const createTable = ({ tableNumber }) =>
  api('/api/orders/tables', { method: 'POST', body: { tableNumber } })

// Solo cambia el numero de mesa; el qrToken es inmutable (GC-ADM-0002)
export const updateTable = (tableId, { tableNumber }) =>
  api(`/api/orders/tables/${tableId}`, { method: 'PUT', body: { tableNumber } })
