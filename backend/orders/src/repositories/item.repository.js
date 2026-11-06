import { prisma } from '../config/prisma.js';

export async function findItemWithOrder(itemId) {
  return prisma.orderItem.findUnique({
    where: { itemId },
    include: {
      round: {
        include: {
          order: {
            include: { table: { select: { tableId: true, tableNumber: true } } },
          },
        },
      },
    },
  });
}

// Anulacion atomica (RNF-12). Nunca "leer, decidir y luego escribir" sin condicion: el item se
// relee dentro de la transaccion y el updateMany se condiciona a ese mismo estado, asi que si
// cocina lo avanza en medio no se pisa el cambio y applied queda en false con el estado real.
// La auditoria se inserta en la misma transaccion: si falla, la anulacion se revierte.
// buildAuditDetails recibe el estado anterior real, no el que vio el servicio antes de entrar.
export async function cancelItemIfStatusIn({
  itemId,
  allowedStatuses,
  userId,
  reason,
  buildAuditDetails,
}) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.orderItem.findUnique({
      where: { itemId },
      select: { status: true },
    });
    if (!current) return { applied: false, status: null };
    if (!allowedStatuses.includes(current.status)) {
      return { applied: false, status: current.status };
    }

    const updated = await tx.orderItem.updateMany({
      where: { itemId, status: current.status },
      data: { status: 'cancelado', cancelledBy: userId, cancelledReason: reason },
    });
    if (updated.count === 0) return { applied: false, status: null };

    await tx.auditLog.create({
      data: {
        actionType: 'ITEM_CANCELLED',
        entityType: 'item',
        entityId: itemId,
        performedBy: userId,
        details: buildAuditDetails(current.status),
      },
    });

    const item = await tx.orderItem.findUnique({ where: { itemId } });
    return { applied: true, item };
  });
}
