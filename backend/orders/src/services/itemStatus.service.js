import { AppError } from '../errors/AppError.js';
import { mapItem } from '../mappers/item.mapper.js';
import { emitItemStatusChanged } from '../realtime/events.js';
import { advanceItemStatus, findItemWithOrder } from '../repositories/item.repository.js';

// Las unicas transiciones de cocina. Entregar es del mesero (GC-ORD-0005) y anular tiene su endpoint.
const NEXT_STATUS = { pendiente: 'en_preparacion', en_preparacion: 'listo' };
const TIMESTAMP_FIELD = { en_preparacion: 'preparationStartedAt', listo: 'readyAt' };

function invalidTransition(from, to) {
  return new AppError({
    status: 409,
    code: 'INVALID_TRANSITION',
    message: `No se puede pasar un ítem de ${from} a ${to}`,
    details: { from, to },
  });
}

export async function updateItemStatus(itemId, status) {
  const item = await findItemWithOrder(itemId);
  if (!item) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'El ítem no existe' });
  }

  const order = item.round.order;
  if (order.status === 'CERRADA') {
    throw new AppError({
      status: 409,
      code: 'INVALID_TRANSITION',
      message: 'La orden de este ítem ya está cerrada',
    });
  }
  if (NEXT_STATUS[item.status] !== status) throw invalidTransition(item.status, status);

  const updated = await advanceItemStatus({
    itemId,
    from: item.status,
    to: status,
    timestampField: TIMESTAMP_FIELD[status],
  });

  // Otro cocinero lo avanzo, el ADMIN lo anulo o la orden se cerro entre la lectura y la escritura.
  if (!updated) {
    const fresh = await findItemWithOrder(itemId);
    throw invalidTransition(fresh?.status ?? item.status, status);
  }

  const mapped = mapItem(updated);

  // Evento solo despues del commit. waiterId se lee aqui: si la mesa se reasigno, avisa al mesero actual.
  emitItemStatusChanged({
    item: mapped,
    orderId: order.orderId,
    tableNumber: order.table.tableNumber,
    waiterId: order.waiterId,
  });

  return mapped;
}
