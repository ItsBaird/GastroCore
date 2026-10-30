import { AppError } from '../errors/AppError.js';
import { emitTableStatusChanged } from '../realtime/events.js';
import {
  createOrder,
  findOpenOrderByTable,
  findTableById,
} from '../repositories/openTable.repository.js';

export async function openTable(tableId, userId) {
  const table = await findTableById(tableId);
  if (!table) {
    throw new AppError({
      status: 404,
      code: 'TABLE_NOT_FOUND',
      message: 'La mesa no existe',
    });
  }

  const existing = await findOpenOrderByTable(tableId);
  if (existing) {
    throw new AppError({
      status: 409,
      code: 'TABLE_ALREADY_OPEN',
      message: 'La mesa ya tiene una orden abierta',
    });
  }

  const order = await createOrder({
    tableId,
    openedBy: userId,
    waiterId: userId,
  });

  emitTableStatusChanged({
    tableId: table.tableId,
    tableNumber: table.tableNumber,
    status: 'ocupada',
    orderId: order.orderId,
    waiterId: order.waiterId,
    pendingCalls: [],
  });

  return order;
}
