import { prisma } from '../config/prisma.js';

// Lo que el cliente del QR ve de su orden sin cerrar: los items de cada ronda (en el orden en que se pidieron)
// y las solicitudes QR que aun no son ronda (pendientes o rechazadas). Una solicitud confirmada ya es una
// ronda con sus items, asi que no se trae. Solo los campos que se muestran.
export async function findOrderStatusForQr(orderId) {
  return prisma.order.findUnique({
    where: { orderId },
    select: {
      status: true,
      discountAmount: true,
      rounds: {
        orderBy: { createdAt: 'asc' },
        select: {
          items: {
            orderBy: [{ createdAt: 'asc' }, { itemId: 'asc' }],
            select: {
              itemId: true,
              productNameSnapshot: true,
              unitPriceSnapshot: true,
              quantity: true,
              note: true,
              status: true,
            },
          },
        },
      },
      qrRequests: {
        where: { status: { in: ['pendiente', 'rechazada'] } },
        orderBy: { createdAt: 'asc' },
        select: {
          status: true,
          createdAt: true,
          items: { select: { productId: true, quantity: true, note: true } },
        },
      },
    },
  });
}
