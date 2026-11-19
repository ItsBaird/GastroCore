import { staffClient } from '../clients/staffClient.js';
import { AppError } from '../errors/AppError.js';
import { emitTableStatusChanged } from '../realtime/events.js';
import {
  createOrder,
  findOpenOrderByTable,
  findTableById,
} from '../repositories/openTable.repository.js';
import { getTableStatus } from './tableStatus.service.js';

function tableAlreadyOpen() {
  return new AppError({
    status: 409,
    code: 'TABLE_ALREADY_OPEN',
    message: 'La mesa ya tiene una orden abierta',
  });
}

// El turno controla que meseros estan disponibles y que no salgan con mesas abiertas (HAS_OPEN_TABLES).
// El ADMIN supervisa sin turno programado y cubre en hora pico: abre sin turno, opened_by conserva la autoria.
export async function openTable(tableId, userId, role) {
  const table = await findTableById(tableId);
  if (!table) {
    throw new AppError({
      status: 404,
      code: 'TABLE_NOT_FOUND',
      message: 'La mesa no existe',
    });
  }

  const existing = await findOpenOrderByTable(tableId);
  if (existing) throw tableAlreadyOpen();

  if (role !== 'ADMIN' && !(await staffClient.hasActiveShift(userId))) {
    throw new AppError({
      status: 409,
      code: 'NO_ACTIVE_SHIFT',
      message: 'Debes iniciar tu turno para abrir una mesa',
    });
  }

  let order;
  try {
    order = await createOrder({
      tableId,
      openedBy: userId,
      waiterId: userId,
    });
  } catch (err) {
    // Dos meseros a la vez: uix_orders_one_open_per_table deja pasar solo a uno
    if (err?.code === 'P2002') throw tableAlreadyOpen();
    throw err;
  }

  const tableStatus = await getTableStatus(tableId);
  if (tableStatus) emitTableStatusChanged(tableStatus);

  return order;
}
