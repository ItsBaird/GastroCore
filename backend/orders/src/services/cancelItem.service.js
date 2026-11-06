import { AppError } from '../errors/AppError.js';
import { mapItem } from '../mappers/item.mapper.js';
import { emitItemStatusChanged, emitTableStatusChanged } from '../realtime/events.js';
import { cancelItemIfStatusIn, findItemWithOrder } from '../repositories/item.repository.js';
import { getTableStatus } from './tableStatus.service.js';

// Un item entregado ya se sirvio y uno cancelado no es idempotente: 409 para todos los roles.
// Corregir algo ya entregado es otra historia (GC-RPT-0002).
const TERMINAL_STATUSES = ['entregado', 'cancelado'];
const ADMIN_CANCELLABLE = ['pendiente', 'en_preparacion', 'listo'];
const WAITER_CANCELLABLE = ['pendiente'];

function cancellableFor(role) {
  return role === 'ADMIN' ? ADMIN_CANCELLABLE : WAITER_CANCELLABLE;
}

function itemNotFound() {
  return new AppError({ status: 404, code: 'NOT_FOUND', message: 'El ítem no existe' });
}

function notYourTable() {
  return new AppError({
    status: 403,
    code: 'FORBIDDEN',
    message: 'No tienes asignada esta mesa',
  });
}

function onlyAdminCanCancel() {
  return new AppError({
    status: 403,
    code: 'FORBIDDEN',
    message: 'Solo el ADMIN puede anular ítems fuera del estado pendiente',
  });
}

function invalidTransition(message) {
  return new AppError({ status: 409, code: 'INVALID_TRANSITION', message });
}

export async function cancelItem(itemId, reason, user) {
  const item = await findItemWithOrder(itemId);
  if (!item) throw itemNotFound();

  const order = item.round.order;

  // Pertenencia antes que estado: a un mesero ajeno no se le revela en que va el item.
  if (user.role === 'WAITER' && order.waiterId !== user.userId) throw notYourTable();

  if (order.status !== 'ABIERTA') {
    throw invalidTransition(
      'Solo se pueden anular ítems de una orden abierta; cancela primero el cobro',
    );
  }

  if (TERMINAL_STATUSES.includes(item.status)) {
    throw invalidTransition(`No se puede anular un ítem en estado ${item.status}`);
  }

  const allowed = cancellableFor(user.role);
  if (!allowed.includes(item.status)) throw onlyAdminCanCancel();

  const result = await cancelItemIfStatusIn({
    itemId,
    allowedStatuses: allowed,
    userId: user.userId,
    reason,
    buildAuditDetails: (previousStatus) => ({
      previousStatus,
      reason,
      orderId: order.orderId,
      tableNumber: order.table.tableNumber,
      productId: item.productId,
      productName: item.productNameSnapshot,
      quantity: item.quantity,
      unitPrice: item.unitPriceSnapshot,
      cancelledAmount: item.quantity * item.unitPriceSnapshot,
    }),
  });

  // Cocina pudo avanzar el item entre la lectura y la escritura: se responde por el estado real.
  if (!result.applied) {
    const fresh = await findItemWithOrder(itemId);
    if (!fresh) throw itemNotFound();
    if (TERMINAL_STATUSES.includes(fresh.status)) {
      throw invalidTransition(`No se puede anular un ítem en estado ${fresh.status}`);
    }
    if (!allowed.includes(fresh.status)) throw onlyAdminCanCancel();
    throw invalidTransition('El ítem cambió de estado durante la anulación; vuelve a intentarlo');
  }

  const mapped = mapItem(result.item);

  // Eventos solo despues del commit.
  emitItemStatusChanged({
    item: mapped,
    orderId: order.orderId,
    tableNumber: order.table.tableNumber,
    waiterId: order.waiterId,
  });

  // El panel de mesas decide "Ver Detalle" vs "Tomar Pedido" por itemsCount, asi que al anular
  // hay que reenviarle el estado de la mesa recalculado.
  const tableStatus = await getTableStatus(order.tableId);
  if (tableStatus) emitTableStatusChanged(tableStatus);

  return mapped;
}
