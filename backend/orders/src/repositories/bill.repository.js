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
