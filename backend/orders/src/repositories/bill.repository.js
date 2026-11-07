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
