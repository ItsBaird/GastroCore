import { api } from './client.js'

// GC-QR-0003 (Oscar). Solicitudes QR pendientes de ordenes no cerradas: el WAITER ve las de sus mesas y el
// ADMIN todas. No acepta parametros.
export const listPendingQrRequests = () => api('/api/orders/qr-requests')
