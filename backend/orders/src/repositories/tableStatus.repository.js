import { prisma } from '../config/prisma.js';

// Los items cancelados no cuentan: no se cobran ni entran en reportes (GC-ORD-0009).
const openOrdersInclude = {
  orders: {
    where: { status: { not: 'CERRADA' } },
    select: {
      orderId: true,
      waiterId: true,
      status: true,
      rounds: {
        select: {
          items: {
            where: { status: { not: 'cancelado' } },
            select: { itemId: true },
          },
        },
      },
    },
  },
  serviceCalls: {
    where: { status: 'pendiente' },
    select: {
      serviceCallId: true,
      tableId: true,
      type: true,
      status: true,
      createdAt: true,
    },
  },
};

export async function findAllTablesWithOpenOrdersAndPendingCalls() {
  return prisma.diningTable.findMany({
    orderBy: { tableNumber: 'asc' },
    include: openOrdersInclude,
  });
}

export async function findTableWithOpenOrderAndPendingCalls(tableId) {
  return prisma.diningTable.findUnique({
    where: { tableId },
    include: openOrdersInclude,
  });
}
