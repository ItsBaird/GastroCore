import { prisma } from '../config/prisma.js';
import { createRoundWithItems, lockOpenOrder } from './round.repository.js';

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

// Solicitud con lo necesario para resolverla: sus items, y de la orden el estado, el mesero y la mesa.
export async function findQrRequestForResolution(qrRequestId) {
  return prisma.qrRequest.findUnique({
    where: { qrRequestId },
    include: {
      items: true,
      order: {
        select: {
          orderId: true,
          tableId: true,
          status: true,
          waiterId: true,
          table: { select: { tableNumber: true } },
        },
      },
    },
  });
}

// Rechazo atomico: solo cambia si la solicitud sigue 'pendiente' (CHECK chk_qr_requests_resolution exige
// resolved_by y resolved_at al resolver). Dos meseros que la toquen a la vez no se pisan: el segundo recibe null.
export async function markQrRequestRejected({ qrRequestId, resolvedBy }) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.qrRequest.updateMany({
      where: { qrRequestId, status: 'pendiente' },
      data: { status: 'rechazada', resolvedBy, resolvedAt: new Date() },
    });
    if (updated.count === 0) return null;
    return tx.qrRequest.findUnique({ where: { qrRequestId }, include: { items: true } });
  });
}

// Confirmacion atomica: la solicitud pasa a 'confirmada' y se crea su ronda (source QR, rounds.qr_request_id
// UNIQUE) en la misma transaccion; o quedan las dos cosas o ninguna. Devuelve:
//   - 'ORDER_NOT_OPEN' si la orden ya no esta ABIERTA (paso a cobro o se cerro),
//   - null si la solicitud ya no estaba 'pendiente' (la resolvio otro mesero o el mismo con doble clic),
//   - la ronda con sus items en caso contrario.
// Los items llegan con el snapshot ya tomado (R3). El ORDEN de los candados importa: primero la orden
// (lockOpenOrder) y despues la solicitud. El pago bloquea la orden y luego las solicitudes QR; tomarlos en el
// mismo orden evita el interbloqueo, y la confirmacion simplemente espera al pago y responde 409.
export async function confirmQrRequestWithRound({ qrRequestId, orderId, resolvedBy, items }) {
  return prisma.$transaction(async (tx) => {
    if (!(await lockOpenOrder(tx, orderId))) return 'ORDER_NOT_OPEN';

    const updated = await tx.qrRequest.updateMany({
      where: { qrRequestId, status: 'pendiente' },
      data: { status: 'confirmada', resolvedBy, resolvedAt: new Date() },
    });
    if (updated.count === 0) return null;

    return createRoundWithItems(
      { orderId, source: 'QR', qrRequestId, createdBy: resolvedBy, items },
      tx,
    );
  });
}
