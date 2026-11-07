import { AppError } from '../errors/AppError.js';
import { mapItem } from '../mappers/item.mapper.js';
import { emitItemStatusChanged } from '../realtime/events.js';
import { deliverReadyItem, findItemWithOrder } from '../repositories/item.repository.js';

// GC-ORD-0005. Unica transicion: listo -> entregado. Se permite con la orden ABIERTA o EN_COBRO
// (decision aprobada en la PARADA 0: entregar no cambia la cuenta y cocina puede terminar platos de una
// mesa en cobro); con la orden CERRADA no.

function itemNotFound() {
  return new AppError({ status: 404, code: 'NOT_FOUND', message: 'El ítem no existe' });
}

function invalidTransition(from, message) {
  return new AppError({
    status: 409,
    code: 'INVALID_TRANSITION',
    message: message ?? `Solo se entregan ítems listos; este está ${from}`,
    details: { from, to: 'entregado' },
  });
}

export async function deliverItem(itemId, user) {
  const item = await findItemWithOrder(itemId);
  if (!item) throw itemNotFound();

  const order = item.round.order;

  // Pertenencia antes que estado: a un mesero ajeno no se le revela en que va el item.
  if (user.role === 'WAITER' && order.waiterId !== user.userId) {
    throw new AppError({ status: 403, code: 'FORBIDDEN', message: 'No tienes asignada esta mesa' });
  }

  if (order.status === 'CERRADA') {
    throw invalidTransition(item.status, 'La orden de este ítem ya está cerrada');
  }
  if (item.status !== 'listo') throw invalidTransition(item.status);

  const updated = await deliverReadyItem(itemId);

  // Carrera: lo anularon, otro dispositivo lo entrego o la orden se cerro en medio.
  if (!updated) {
    const fresh = await findItemWithOrder(itemId);
    if (!fresh) throw itemNotFound();
    if (fresh.round.order.status === 'CERRADA') {
      throw invalidTransition(fresh.status, 'La orden de este ítem ya está cerrada');
    }
    throw invalidTransition(fresh.status);
  }

  const mapped = mapItem(updated);

  // Evento solo despues del commit. waiterId se lee aqui: tras una reasignacion avisa al mesero actual.
  emitItemStatusChanged({
    item: mapped,
    orderId: order.orderId,
    tableNumber: order.table.tableNumber,
    waiterId: order.waiterId,
  });

  return mapped;
}
