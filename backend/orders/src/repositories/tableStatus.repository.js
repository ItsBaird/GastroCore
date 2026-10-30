import { prisma } from '../config/prisma.js';

export async function findAllTablesWithOpenOrdersAndPendingCalls() {
  return prisma.diningTable.findMany({
    orderBy: { tableNumber: 'asc' },
    include: {
      orders: {
        where: { status: { not: 'CERRADA' } },
        select: {
          orderId: true,
          waiterId: true,
          status: true,
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
    },
  });
}
