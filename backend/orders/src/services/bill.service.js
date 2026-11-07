import { AppError } from '../errors/AppError.js';
import { findOrderForBill } from '../repositories/bill.repository.js';
import { assertBillPayable, computeBill } from './computeBill.js';

function orderNotFound() {
  return new AppError({ status: 404, code: 'NOT_FOUND', message: 'La orden no existe' });
}

function invalidTransition(message) {
  return new AppError({ status: 409, code: 'INVALID_TRANSITION', message });
}

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
export async function getBill(orderId, user) {
  const order = await loadOwnedOrder(orderId, user);
  if (order.status === 'CERRADA') throw invalidTransition('La orden ya está cerrada');
  return toBill(order);
}
