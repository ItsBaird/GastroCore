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
