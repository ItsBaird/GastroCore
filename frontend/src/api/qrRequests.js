import { api } from './client.js'

// GC-QR-0003 (Oscar). Solicitudes QR pendientes de ordenes no cerradas: el WAITER ve las de sus mesas y el
// ADMIN todas. No acepta parametros.
export const listPendingQrRequests = () => api('/api/orders/qr-requests')

// GC-QR-0003. Confirmar: sin cuerpo se confirma tal como la pidio el cliente; con items el mesero la ajusta
// (reemplazan a los de la solicitud). R4: por item solo productId, quantity y note; el precio lo toma el
// backend de Catalog (snapshot R3). Responde { round, unavailable? }.
export const confirmQrRequest = (qrRequestId, items) =>
  api(`/api/orders/qr-requests/${qrRequestId}/confirm`, {
    method: 'PUT',
    ...(items && {
      body: {
        items: items.map(({ productId, quantity, note }) => ({
          productId,
          quantity,
          ...(note?.trim() && { note: note.trim() }),
        })),
      },
    }),
  })

// Rechazar: sin cuerpo (el contrato no admite motivo)
export const rejectQrRequest = (qrRequestId) =>
  api(`/api/orders/qr-requests/${qrRequestId}/reject`, { method: 'PUT' })
