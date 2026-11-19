import { findPendingQrRequests } from '../repositories/qrRequest.repository.js';

// Misma forma que el payload del evento qr_request:created (QrRequestWithTable del contrato): la pantalla del
// mesero usa un solo manejador para lo que llega por el evento y para lo que recupera al recargar.
function toQrRequestWithTable(request) {
  return {
    qrRequestId: request.qrRequestId,
    orderId: request.orderId,
    status: request.status,
    createdAt: request.createdAt,
    resolvedAt: request.resolvedAt ?? null,
    resolvedBy: request.resolvedBy ?? null,
    items: request.items.map(({ productId, quantity, note }) => ({
      productId,
      quantity,
      ...(note ? { note } : {}),
    })),
    tableNumber: request.order.table.tableNumber,
  };
}

// Los eventos de Socket.io no se reenvian: un mesero que recarga, cambia de app o pierde la conexion no veria
// las solicitudes que llegaron mientras tanto. Este listado es el respaldo (se pide al abrir la pantalla y al
// reconectar). Un mesero ve solo las de sus mesas; el ADMIN, todas. El cocinero no entra (lo corta la ruta).
export async function listPendingQrRequests(user) {
  const requests = await findPendingQrRequests({
    waiterId: user.role === 'WAITER' ? user.userId : undefined,
  });
  return requests.map(toQrRequestWithTable);
}
