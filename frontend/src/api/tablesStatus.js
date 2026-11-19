import { api } from './client.js'

export const listTableStatuses = () => api('/api/orders/tables/status')

export const openTable = (tableId) =>
  api(`/api/orders/tables/${tableId}/open`, { method: 'POST' })
