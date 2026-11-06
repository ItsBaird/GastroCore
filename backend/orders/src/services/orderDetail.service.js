import { AppError } from '../errors/AppError.js';
import { findOrderWithRoundsAndItems } from '../repositories/round.repository.js';

function mapItem(item) {
  return {
    itemId: item.itemId,
    roundId: item.roundId,
    productId: item.productId,
    productName: item.productNameSnapshot,
    unitPrice: item.unitPriceSnapshot,
    quantity: item.quantity,
    note: item.note,
    status: item.status,
    preparationStartedAt: item.preparationStartedAt,
    readyAt: item.readyAt,
    deliveredAt: item.deliveredAt,
    cancelledAt: item.cancelledAt,
    cancelledReason: item.cancelledReason,
    cancelledBy: item.cancelledBy,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function mapRound(round) {
  return {
    roundId: round.roundId,
    orderId: round.orderId,
    source: round.source,
    createdBy: round.createdBy,
    createdAt: round.createdAt,
    items: round.items.map(mapItem),
  };
}

export async function getOrderDetail(orderId, user) {
  const order = await findOrderWithRoundsAndItems(orderId);
  if (!order) {
    throw new AppError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'La orden no existe',
    });
  }

  if (user.role === 'WAITER' && order.waiterId !== user.userId) {
    throw new AppError({
      status: 403,
      code: 'FORBIDDEN',
      message: 'No tienes asignada esta mesa',
    });
  }

  return {
    orderId: order.orderId,
    tableId: order.tableId,
    tableNumber: order.table.tableNumber,
    waiterId: order.waiterId,
    status: order.status,
    openedAt: order.openedAt,
    closedAt: order.closedAt,
    discountAmount: order.discountAmount,
    rounds: order.rounds.map(mapRound),
  };
}
