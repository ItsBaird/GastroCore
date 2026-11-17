import { prisma } from '../config/prisma.js';
import { businessDateOf } from '../services/businessDay.js';
import { isBusinessDayClosed, lockBusinessDay } from './dayLock.js';

// Lo que el servicio necesita para decidir: la orden, su estado y su pago (1:1).
export async function findPaymentOfOrder(orderId) {
  return prisma.order.findUnique({
    where: { orderId },
    select: { orderId: true, status: true, closedAt: true, payment: true },
  });
}

// GC-RPT-0002 (GC-157). Corrige el metodo de pago en UNA transaccion: o quedan el cambio y su auditoria, o nada.
//   1. Candado del dia de negocio de la venta (el mismo del cierre de caja y del cobro): la correccion y la
//      confirmacion del cierre de ese dia no se pisan, y `postClosure` es verdad al momento de escribir.
//   2. Cambio condicionado al metodo que el servicio leyo (`expectedMethodId`): dos correcciones simultaneas, o una
//      que llega tras otra, no se sobrescriben a ciegas -> { changed: true } y el servicio responde 409.
//   3. Auditoria PAYMENT_METHOD_CORRECTED: quien (performed_by), cuando (performed_at), que y cuanto (details).
// Solo cambia el metodo y recibido/cambio: subtotal, descuento y total del pago no se tocan. El cierre ya guardado
// tampoco (snapshot inmutable): la correccion queda en audit_log. Devuelve { payment } o { changed: true }.
export async function correctPaymentMethod({
  orderId,
  paymentId,
  closedAt,
  userId,
  expectedMethodId,
  update,
  auditDetails,
}) {
  return prisma.$transaction(async (tx) => {
    const date = businessDateOf(closedAt);
    await lockBusinessDay(tx, date);
    const postClosure = await isBusinessDayClosed(tx, date);

    const changed = await tx.payment.updateMany({
      where: { paymentId, paymentMethodId: expectedMethodId },
      data: update,
    });
    if (changed.count === 0) return { changed: true };

    const payment = await tx.payment.findUnique({ where: { paymentId } });
    await tx.auditLog.create({
      data: {
        actionType: 'PAYMENT_METHOD_CORRECTED',
        entityType: 'order',
        entityId: orderId,
        performedBy: userId,
        details: {
          ...auditDetails,
          postClosure,
          ...(postClosure && { closureDate: date }),
        },
      },
    });
    return { payment };
  });
}
