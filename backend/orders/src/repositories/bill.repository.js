import { prisma } from '../config/prisma.js';

// Orden con todo lo que la cuenta necesita. Items en el orden en que se pidieron.
export async function findOrderForBill(orderId) {
  return prisma.order.findUnique({
    where: { orderId },
    include: {
      table: { select: { tableId: true, tableNumber: true } },
      rounds: {
        orderBy: { createdAt: 'asc' },
        include: { items: { orderBy: [{ createdAt: 'asc' }, { itemId: 'asc' }] } },
      },
    },
  });
}

// ABIERTA -> EN_COBRO en una sola sentencia condicionada al estado y a que siga habiendo al menos un item
// entregado. Dos solicitudes simultaneas: una cambia la fila (count 1) y la otra no (count 0), asi que
// hay una sola transicion y un solo evento.
export async function moveOrderToBilling(orderId) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.order.updateMany({
      where: {
        orderId,
        status: 'ABIERTA',
        rounds: { some: { items: { some: { status: 'entregado' } } } },
      },
      data: { status: 'EN_COBRO' },
    });
    return updated.count === 1;
  });
}

// EN_COBRO -> ABIERTA solo si aun no hay pago registrado (GC-ORD-0008 cierra la orden al pagar).
// GC-ORD-0007: el descuento se autorizo contra el subtotal de este cobro, asi que se quita en la misma
// transaccion y queda en auditoria (DISCOUNT_REMOVED). Devuelve la orden o null si el estado ya no lo permitia.
export async function moveOrderBackToOpen(orderId, userId) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.order.findUnique({
      where: { orderId },
      select: { discountAmount: true, table: { select: { tableNumber: true } } },
    });
    const updated = await tx.order.updateMany({
      where: { orderId, status: 'EN_COBRO', payment: { is: null } },
      data: {
        status: 'ABIERTA',
        discountAmount: 0,
        discountAppliedBy: null,
        discountAppliedAt: null,
      },
    });
    if (updated.count === 0) return null;
    if (current && current.discountAmount > 0) {
      await tx.auditLog.create({
        data: {
          actionType: 'DISCOUNT_REMOVED',
          entityType: 'order',
          entityId: orderId,
          performedBy: userId,
          details: {
            reason: 'Cobro cancelado',
            tableNumber: current.table.tableNumber,
            previousAmount: current.discountAmount,
            newAmount: 0,
          },
        },
      });
    }
    return tx.order.findUnique({ where: { orderId } });
  });
}

// GC-ORD-0007. Fija (o quita, con 0) el descuento de una orden en cobro. Condicionado al estado, a que no
// haya pago y al monto que se leyo: si otro dispositivo lo cambio o se cancelo el cobro en medio, no escribe
// (false). La auditoria va en la misma transaccion: si falla, el descuento se revierte.
export async function setOrderDiscount({ orderId, previousAmount, amount, userId, auditDetails }) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.order.updateMany({
      where: { orderId, status: 'EN_COBRO', discountAmount: previousAmount, payment: { is: null } },
      data:
        amount > 0
          ? { discountAmount: amount, discountAppliedBy: userId, discountAppliedAt: new Date() }
          : { discountAmount: 0, discountAppliedBy: null, discountAppliedAt: null },
    });
    if (updated.count === 0) return false;
    await tx.auditLog.create({
      data: {
        actionType: amount > 0 ? 'DISCOUNT_APPLIED' : 'DISCOUNT_REMOVED',
        entityType: 'order',
        entityId: orderId,
        performedBy: userId,
        details: auditDetails,
      },
    });
    return true;
  });
}
