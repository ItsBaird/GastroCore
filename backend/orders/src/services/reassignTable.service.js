import { staffClient } from '../clients/staffClient.js';
import { AppError } from '../errors/AppError.js';
import { emitTableReassigned } from '../realtime/events.js';
import { findOpenOrderByTable, findTableById } from '../repositories/openTable.repository.js';
import { reassignOrderWaiter } from '../repositories/reassignTable.repository.js';
import { getTableStatus } from './tableStatus.service.js';

const tableNotOpen = () =>
  new AppError({
    status: 409,
    code: 'TABLE_NOT_OPEN',
    message: 'La mesa no tiene una orden abierta',
  });

const sameWaiter = () =>
  new AppError({
    status: 409,
    code: 'INVALID_TRANSITION',
    message: 'La mesa ya está asignada a ese mesero',
  });

export async function reassignTable(tableId, waiterId, admin) {
  const table = await findTableById(tableId);
  if (!table) {
    throw new AppError({ status: 404, code: 'TABLE_NOT_FOUND', message: 'La mesa no existe' });
  }

  const order = await findOpenOrderByTable(tableId);
  if (!order) throw tableNotOpen();
  if (order.waiterId === waiterId) throw sameWaiter();

  if (!(await staffClient.hasActiveShift(waiterId))) {
    throw new AppError({
      status: 409,
      code: 'NO_ACTIVE_SHIFT',
      message: 'El mesero seleccionado no tiene un turno activo',
    });
  }

  const result = await reassignOrderWaiter({
    orderId: order.orderId,
    fromWaiterId: order.waiterId,
    toWaiterId: waiterId,
    performedBy: admin.userId,
    details: {
      orderId: order.orderId,
      tableNumber: table.tableNumber,
      previousWaiterId: order.waiterId,
      newWaiterId: waiterId,
    },
  });

  // Se pago la mesa u otro ADMIN la reasigno entre la lectura y la escritura
  if (!result.applied) {
    const current = await findOpenOrderByTable(tableId);
    if (!current) throw tableNotOpen();
    if (current.waiterId === waiterId) throw sameWaiter();
    throw new AppError({
      status: 409,
      code: 'INVALID_TRANSITION',
      message: 'La mesa cambió de mesero durante la reasignación; vuelve a intentarlo',
    });
  }

  const tableStatus = await getTableStatus(tableId);
  if (tableStatus) {
    emitTableReassigned(tableStatus, { previousWaiterId: order.waiterId, newWaiterId: waiterId });
  }

  return result.order;
}
