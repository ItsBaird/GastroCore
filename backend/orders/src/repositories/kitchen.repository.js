import { prisma } from '../config/prisma.js';

// Lo que cocina todavia debe ver. "listo" sigue visible hasta que el mesero lo entregue.
const KITCHEN_STATUSES = ['pendiente', 'en_preparacion', 'listo'];

// Mas antigua primero. itemId y roundId desempatan: los items de una ronda nacen en el mismo instante
// y sin desempate cambiarian de lugar entre una consulta y otra.
export async function findKitchenRounds() {
  return prisma.round.findMany({
    where: {
      order: { status: { not: 'CERRADA' } },
      items: { some: { status: { in: KITCHEN_STATUSES } } },
    },
    include: {
      items: {
        where: { status: { in: KITCHEN_STATUSES } },
        orderBy: [{ createdAt: 'asc' }, { itemId: 'asc' }],
      },
      order: { select: { table: { select: { tableNumber: true } } } },
    },
    orderBy: [{ createdAt: 'asc' }, { roundId: 'asc' }],
  });
}
