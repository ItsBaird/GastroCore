import { prisma } from '../config/prisma.js';

export async function findTableById(tableId) {
  return prisma.diningTable.findUnique({ where: { tableId } });
}

export async function findOpenOrderByTable(tableId) {
  return prisma.order.findFirst({
    where: { tableId, status: { not: 'CERRADA' } },
  });
}

export async function createOrder({ tableId, openedBy, waiterId }) {
  return prisma.order.create({
    data: { tableId, openedBy, waiterId, status: 'ABIERTA' },
    select: {
      orderId: true,
      tableId: true,
      waiterId: true,
      status: true,
      openedAt: true,
    },
  });
}
