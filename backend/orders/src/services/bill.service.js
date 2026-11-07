import { AppError } from '../errors/AppError.js';
import { emitTableStatusChanged } from '../realtime/events.js';
import { findOrderForBill, moveOrderToBilling } from '../repositories/bill.repository.js';
import { assertBillPayable, computeBill } from './computeBill.js';
import { getTableStatus } from './tableStatus.service.js';

function orderNotFound() {
  return new AppError({ status: 404, code: 'NOT_FOUND', message: 'La orden no existe' });
}

function invalidTransition(message) {
  return new AppError({ status: 409, code: 'INVALID_TRANSITION', message });
}

function noDeliveredItems() {
  return new AppError({
    status: 409,
    code: 'NO_DELIVERED_ITEMS',
    message: 'Para generar la cuenta debe haber al menos un ítem entregado',
  });
}

const hasDeliveredItem = (order) =>
  order.rounds.some((round) => round.items.some((item) => item.status === 'entregado'));

async function loadOwnedOrder(orderId, user) {
  const order = await findOrderForBill(orderId);
  if (!order) throw orderNotFound();
  if (user.role === 'WAITER' && order.waiterId !== user.userId) {
    throw new AppError({ status: 403, code: 'FORBIDDEN', message: 'No tienes asignada esta mesa' });
  }
  return order;
}

function toBill(order) {
  const bill = computeBill(order);
  if (!assertBillPayable(bill)) {
    throw invalidTransition('El descuento supera el subtotal de la cuenta');
  }
  return {
    orderId: order.orderId,
    tableNumber: order.table.tableNumber,
    status: order.status,
    ...bill,
  };
}

// GC-ORD-0006. La cuenta es una vista calculada: no se persiste (el pago la recalcula).
// Con la orden ABIERTA la pasa a EN_COBRO; con la orden ya EN_COBRO es idempotente: misma cuenta
// recalculada, sin otra transicion ni otro evento.
export async function getBill(orderId, user) {
  const order = await loadOwnedOrder(orderId, user);
  if (order.status === 'CERRADA') throw invalidTransition('La orden ya está cerrada');
  if (order.status === 'EN_COBRO') return toBill(order);

  if (!hasDeliveredItem(order)) throw noDeliveredItems();
  // Antes de cambiar el estado: una cuenta que no se puede pagar no deja la mesa en cobro
  toBill(order);

  const moved = await moveOrderToBilling(orderId);

  // Releer siempre: la cuenta sale del estado real despues de la escritura
  const fresh = await findOrderForBill(orderId);
  if (!fresh) throw orderNotFound();

  if (!moved) {
    // Otra solicitud la paso a cobro primero (idempotente) o el estado cambio en medio
    if (fresh.status === 'CERRADA') throw invalidTransition('La orden ya está cerrada');
    if (fresh.status !== 'EN_COBRO') throw noDeliveredItems();
    return toBill(fresh);
  }

  // Evento solo despues del commit, con el estado de la mesa recalculado (en_cobro)
  const tableStatus = await getTableStatus(fresh.tableId);
  if (tableStatus) emitTableStatusChanged(tableStatus);

  return toBill(fresh);
}
