import { api } from './client.js'

export const listTableStatuses = () => api('/api/orders/tables/status')
