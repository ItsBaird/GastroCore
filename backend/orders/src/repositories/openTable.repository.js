import { prisma } from '../config/prisma.js';

export async function findTableById(tableId) {
  return prisma.diningTable.findUnique({ where: { tableId } });
}

export async function findOpenOrderByTable(tableId) {
  return prisma.order.findFirst({
    where: { tableId, status: { not: 'CERRADA' } },
  });
}

// Abre la orden y, en la misma transaccion, marca como atendidos los llamados pendientes de la mesa
// (call_waiter y request_bill) con attended_by = quien abre (contrato de /open, HU GC-30 criterio 1: al abrir la
// mesa el mesero ya llego). Si la orden no se crea (P2002: otro mesero la abrio primero) no se toca ningun llamado.
export async function createOrder({ tableId, openedBy, waiterId }) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: { tableId, openedBy, waiterId, status: 'ABIERTA' },
      select: {
        orderId: true,
        tableId: true,
        waiterId: true,
        status: true,
        openedAt: true,
      },
    });
    await tx.serviceCall.updateMany({
      where: { tableId, status: 'pendiente' },
      data: { status: 'atendido', attendedBy: openedBy, attendedAt: order.openedAt },
    });
    return order;
  });
}
