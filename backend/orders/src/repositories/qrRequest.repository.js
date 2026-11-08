import { prisma } from '../config/prisma.js';

// Solicitudes de pedido del QR que el mesero todavia no ha resuelto en esta orden
export async function countPendingQrRequests(orderId) {
  return prisma.qrRequest.count({ where: { orderId, status: 'pendiente' } });
}

// La solicitud y sus items se crean juntos (escritura anidada): o quedan los dos o ninguno.
// `status` nace 'pendiente' y resolved_by / resolved_at en null (CHECK chk_qr_requests_resolution).
export async function createQrRequestWithItems({ orderId, items }) {
  return prisma.qrRequest.create({
    data: {
      orderId,
      items: {
        create: items.map(({ productId, quantity, note }) => ({
          productId,
          quantity,
          note: note ?? null,
        })),
      },
    },
  });
}

// Solicitudes pendientes de las ordenes sin cerrar, de la mas antigua a la mas reciente (orden de llegada).
// Con `waiterId` solo las de las ordenes que ese mesero tiene asignadas; sin el, todas (ADMIN).
// Una orden en cobro tambien cuenta: sus solicitudes pendientes siguen ahi hasta que el mesero las resuelva.
// qr_request_items no tiene columna de orden: los items salen en el orden en que los devuelve la base.
export async function findPendingQrRequests({ waiterId } = {}) {
  return prisma.qrRequest.findMany({
    where: {
      status: 'pendiente',
      order: { status: { not: 'CERRADA' }, ...(waiterId && { waiterId }) },
    },
    orderBy: { createdAt: 'asc' },
    include: {
      items: true,
      order: { select: { table: { select: { tableNumber: true } } } },
    },
  });
}
