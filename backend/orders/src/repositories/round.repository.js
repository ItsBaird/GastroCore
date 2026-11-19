import { prisma } from '../config/prisma.js';

export async function findOrderById(orderId) {
  return prisma.order.findUnique({
    where: { orderId },
    include: { table: { select: { tableNumber: true } } },
  });
}

// Alta de una ronda con sus items (snapshot R3 ya tomado: productName y unitPrice). Con `tx` se ejecuta dentro
// de una transaccion del llamador (la confirmacion de una solicitud QR la crea junto al cambio de estado).
// `qrRequestId` liga la ronda a la solicitud que la origino (rounds.qr_request_id UNIQUE).
export async function createRoundWithItems(
  { orderId, source, createdBy, items, qrRequestId = null },
  tx = prisma,
) {
  return tx.round.create({
    data: {
      orderId,
      source,
      createdBy,
      qrRequestId,
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

// Toma el candado de la fila de la orden mientras siga ABIERTA. Un UPDATE sin cambios bloquea la fila y, si
// otra transaccion la tenia (solicitar el cobro, pagar), espera y vuelve a evaluar la condicion con el estado
// ya confirmado. Asi una ronda nunca entra a una orden que paso a EN_COBRO en medio. false si ya no esta ABIERTA.
// Debe ser lo PRIMERO que bloquee la transaccion: el pago bloquea la orden y luego las solicitudes QR, y tomar
// los candados en el mismo orden evita interbloqueos.
export async function lockOpenOrder(tx, orderId) {
  const locked = await tx.order.updateMany({
    where: { orderId, status: 'ABIERTA' },
    data: { status: 'ABIERTA' },
  });
  return locked.count === 1;
}

// Ronda en una orden que sigue ABIERTA: candado y alta en la misma transaccion. null si dejo de estar abierta.
export async function createRoundInOpenOrder(round) {
  return prisma.$transaction(async (tx) => {
    if (!(await lockOpenOrder(tx, round.orderId))) return null;
    return createRoundWithItems(round, tx);
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
