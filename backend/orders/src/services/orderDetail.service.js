import { AppError } from '../errors/AppError.js';
import { mapRound } from '../mappers/item.mapper.js';
import { findOrderWithRoundsAndItems } from '../repositories/round.repository.js';

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
