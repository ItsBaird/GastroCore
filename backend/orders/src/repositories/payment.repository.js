import { prisma } from '../config/prisma.js';

const LIVE_ITEM_STATUSES = ['pendiente', 'en_preparacion', 'listo'];

// GC-ORD-0008. Cierre de la venta en una sola transaccion: o queda todo o nada.
//   1. EN_COBRO -> CERRADA con closedAt, condicionado a lo que el servicio leyo y valido: que siga en cobro,
//      sin pago, con el mismo descuento (el total cobrado es el que se calculo) y sin items vivos. Dos
//      cobros simultaneos: uno cambia la fila (count 1) y el otro no (count 0) -> un solo pago.
//   2. El pago, con el snapshot de la cuenta (subtotal, descuento, quien lo aplico, total, recibido, cambio).
//   3. Las solicitudes QR que seguian pendientes se rechazan: la orden cerrada ya no puede recibir rondas y
//      la mesa queda libre para el siguiente cliente (CHECK chk_qr_requests_resolution: resolved_by y _at).
//   4. Los llamados pendientes de la mesa (call_waiter y request_bill) pasan a atendido por quien cobra: si no,
//      el indice uix_service_calls_one_pending dejaria al siguiente cliente sin poder llamar
//      (CHECK chk_service_calls_resolution: attended_by y _at).
//   5. Auditoria PAYMENT_REGISTERED.
// Contrato de /pay (docs/gc-ord-0008-pago-limpieza, aprobado por Oscar).
// Devuelve { payment, rejectedQrRequests, attendedServiceCalls } o null si la orden ya no estaba como se leyo.
export async function closeOrderWithPayment({ orderId, tableId, payment, userId, auditDetails }) {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const closed = await tx.order.updateMany({
      where: {
        orderId,
        status: 'EN_COBRO',
        discountAmount: payment.discountAmount,
        payment: { is: null },
        rounds: { none: { items: { some: { status: { in: LIVE_ITEM_STATUSES } } } } },
      },
      data: { status: 'CERRADA', closedAt: now },
    });
    if (closed.count === 0) return null;

    const created = await tx.payment.create({
      data: { orderId, ...payment, registeredBy: userId, paidAt: now },
    });

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
        actionType: 'PAYMENT_REGISTERED',
        entityType: 'order',
        entityId: orderId,
        performedBy: userId,
        details: {
          ...auditDetails,
          paymentId: created.paymentId,
          ...(rejected.count > 0 && { rejectedQrRequests: rejected.count }),
          ...(attended.count > 0 && { attendedServiceCalls: attended.count }),
        },
      },
    });

    return {
      payment: created,
      rejectedQrRequests: rejected.count,
      attendedServiceCalls: attended.count,
    };
  });
}
