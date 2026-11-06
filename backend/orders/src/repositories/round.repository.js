import { prisma } from '../config/prisma.js';

export async function findOrderById(orderId) {
  return prisma.order.findUnique({
    where: { orderId },
    include: { table: { select: { tableNumber: true } } },
  });
}

export async function createRoundWithItems({ orderId, source, createdBy, items }) {
  return prisma.round.create({
    data: {
      orderId,
      source,
      createdBy,
      items: {
        create: items.map((item) => ({
          productId: item.productId,
          productNameSnapshot: item.productName,
          unitPriceSnapshot: item.unitPrice,
          quantity: item.quantity,
          note: item.note || null,
        })),
      },
    },
    include: {
      items: true,
    },
  });
}

export async function findOrderWithRoundsAndItems(orderId) {
  return prisma.order.findUnique({
    where: { orderId },
    include: {
      table: { select: { tableNumber: true } },
      rounds: {
        orderBy: { createdAt: 'asc' },
        include: {
          items: { orderBy: { itemId: 'asc' } },
        },
      },
    },
  });
}
