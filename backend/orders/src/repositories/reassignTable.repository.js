import { prisma } from '../config/prisma.js';

// Condicionado al mesero leido: si otro ADMIN reasigno o la orden se cerro en medio, no se pisa nada
// y applied queda en false. La auditoria va en la misma transaccion: si falla, se revierte el cambio.
export async function reassignOrderWaiter({
  orderId,
  fromWaiterId,
  toWaiterId,
  performedBy,
  details,
}) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.order.updateMany({
      where: { orderId, waiterId: fromWaiterId, status: { not: 'CERRADA' } },
      data: { waiterId: toWaiterId },
    });
    if (updated.count === 0) return { applied: false };

    await tx.auditLog.create({
      data: {
        actionType: 'TABLE_REASSIGNED',
        entityType: 'order',
        entityId: orderId,
        performedBy,
        details,
      },
    });

    const order = await tx.order.findUnique({ where: { orderId } });
    return { applied: true, order };
  });
}
