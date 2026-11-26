import { prisma } from '../config/prisma.js';

// Cerrar sin cobro una mesa abierta por error (solo ADMIN), en una sola transaccion:
//   1. ABIERTA -> CERRADA con closedAt, condicionado a que siga abierta, sin pago y sin ningun item que no este
//      cancelado (lo que se pidio se anula antes; lo entregado se cobra). Dos cierres simultaneos o una ronda
//      que entra en medio: la condicion falla (count 0) y no se cierra.
//   2. Solicitudes QR pendientes -> rechazadas y llamados pendientes de la mesa -> atendidos (igual que el pago):
//      si no, el siguiente cliente no podria llamar (indice uix_service_calls_one_pending).
//   3. Auditoria ORDER_CLOSED_WITHOUT_PAYMENT.
// Sin pago ni items vivos, la orden no entra en ventas, cierre de caja, dashboard ni historial (todos parten de
// payments o de items no cancelados). Devuelve { closedAt, rejectedQrRequests, attendedServiceCalls } o null.
export async function closeOrderWithoutPayment({ orderId, tableId, userId, auditDetails }) {
  return prisma.$transaction(async (tx) => {
    const now = new Date();

    const closed = await tx.order.updateMany({
      where: {
        orderId,
        status: 'ABIERTA',
        payment: { is: null },
        rounds: { none: { items: { some: { status: { not: 'cancelado' } } } } },
      },
      data: { status: 'CERRADA', closedAt: now },
    });
    if (closed.count === 0) return null;

    const rejected = await tx.qrRequest.updateMany({
      where: { orderId, status: 'pendiente' },
      data: { status: 'rechazada', resolvedBy: userId, resolvedAt: now },
    });

    const attended = await tx.serviceCall.updateMany({
      where: { tableId, status: 'pendiente' },
      data: { status: 'atendido', attendedBy: userId, attendedAt: now },
    });

    await tx.auditLog.create({
      data: {
        actionType: 'ORDER_CLOSED_WITHOUT_PAYMENT',
        entityType: 'order',
        entityId: orderId,
        performedBy: userId,
        details: {
          ...auditDetails,
          ...(rejected.count > 0 && { rejectedQrRequests: rejected.count }),
          ...(attended.count > 0 && { attendedServiceCalls: attended.count }),
        },
      },
    });

    return {
      closedAt: now,
      rejectedQrRequests: rejected.count,
      attendedServiceCalls: attended.count,
    };
  });
}
