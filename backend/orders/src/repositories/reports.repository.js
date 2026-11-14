import { prisma } from '../config/prisma.js';

// Pagos de las ordenes CERRADA cuyo cierre cae en [start, end) (el dia de negocio). Una orden pagada y cerrada
// tiene exactamente un pago (uq_payments_order); `openedBy` es el mesero que abrio la mesa.
export async function findPaymentsOfDay({ start, end }) {
  return prisma.payment.findMany({
    where: { order: { status: 'CERRADA', closedAt: { gte: start, lt: end } } },
    select: { total: true, paymentMethodId: true, order: { select: { openedBy: true } } },
  });
}

// Items vendidos ese dia: los de esas mismas ordenes, sin los cancelados. Al cerrarse una orden no quedan items
// vivos sin entregar (el pago lo exige), asi que lo que no esta cancelado es lo que se sirvio.
export async function findSoldItemsOfDay({ start, end }) {
  return prisma.orderItem.findMany({
    where: {
      status: { not: 'cancelado' },
      round: { order: { status: 'CERRADA', closedAt: { gte: start, lt: end } } },
    },
    select: {
      productId: true,
      productNameSnapshot: true,
      quantity: true,
      unitPriceSnapshot: true,
      createdAt: true,
    },
  });
}
