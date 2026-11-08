import { AppError } from '../errors/AppError.js';
import { emitOrderUpdated } from '../realtime/events.js';
import { findOrderForBill, setOrderDiscount } from '../repositories/bill.repository.js';
import { loadOwnedOrder, toBill } from './bill.service.js';
import { computeBill } from './computeBill.js';

function notInBilling() {
  return new AppError({
    status: 409,
    code: 'INVALID_TRANSITION',
    message: 'Solo se puede aplicar un descuento a una mesa en cobro',
  });
}

// GC-ORD-0007. Aplica, cambia o quita (con 0) el descuento de una orden EN_COBRO. El subtotal sale de
// computeBill (snapshot R3, sin cancelados), la misma funcion que usara el pago (GC-ORD-0008).
export async function applyDiscount(orderId, { discountAmount, reason }, user) {
  const order = await loadOwnedOrder(orderId, user);
  if (order.status !== 'EN_COBRO') throw notInBilling();

  const { subtotal } = computeBill(order);
  if (discountAmount > subtotal) {
    throw new AppError({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'El descuento no puede superar el subtotal de la cuenta',
      details: { field: 'discountAmount', subtotal, discountAmount },
    });
  }

  const previousAmount = order.discountAmount ?? 0;
  // Mismo monto: idempotente, sin auditoria ni evento
  if (discountAmount === previousAmount) return toBill(order);

  const applied = await setOrderDiscount({
    orderId,
    previousAmount,
    amount: discountAmount,
    userId: user.userId,
    auditDetails: {
      tableNumber: order.table.tableNumber,
      previousAmount,
      newAmount: discountAmount,
      subtotal,
      total: subtotal - discountAmount,
      authorizedBy: user.role === 'ADMIN' ? 'role:ADMIN' : 'permission:discount:apply',
      ...(reason && { reason }),
    },
  });

  const fresh = await findOrderForBill(orderId);
  if (!applied) {
    // Se cancelo el cobro, se pago o otro dispositivo cambio el descuento entre la lectura y la escritura
    if (!fresh || fresh.status !== 'EN_COBRO') throw notInBilling();
    throw new AppError({
      status: 409,
      code: 'INVALID_TRANSITION',
      message: 'El descuento cambió mientras lo aplicabas; revisa la cuenta e inténtalo de nuevo',
    });
  }

  // Evento solo despues del commit, al mesero actual de la orden
  emitOrderUpdated(
    {
      orderId,
      tableNumber: fresh.table.tableNumber,
      status: fresh.status,
      discountAmount: fresh.discountAmount,
    },
    fresh.waiterId,
  );

  return toBill(fresh);
}
