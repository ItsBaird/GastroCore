import { AppError } from '../errors/AppError.js';
import { emitOrderUpdated, emitTableStatusChanged } from '../realtime/events.js';
import { findOrderForBill } from '../repositories/bill.repository.js';
import { closeOrderWithPayment } from '../repositories/payment.repository.js';
import { findPaymentMethodById } from '../repositories/paymentMethod.repository.js';
import { loadOwnedOrder, toBill } from './bill.service.js';
import { getTableStatus } from './tableStatus.service.js';

const LIVE_ITEM_STATUSES = new Set(['pendiente', 'en_preparacion', 'listo']);

function invalidTransition(message, details) {
  return new AppError({ status: 409, code: 'INVALID_TRANSITION', message, details });
}

function validationError(message, details) {
  return new AppError({ status: 400, code: 'VALIDATION_ERROR', message, details });
}

function liveItems(order) {
  return order.rounds.flatMap((round) =>
    round.items
      .filter((item) => LIVE_ITEM_STATUSES.has(item.status))
      .map((item) => ({
        itemId: item.itemId,
        productName: item.productNameSnapshot,
        status: item.status,
      })),
  );
}

// Payment del contrato
function toPayment(payment) {
  return {
    paymentId: payment.paymentId,
    orderId: payment.orderId,
    paymentMethodId: payment.paymentMethodId,
    subtotal: payment.subtotal,
    discountAmount: payment.discountAmount,
    total: payment.total,
    amountReceived: payment.amountReceived,
    changeGiven: payment.changeGiven,
    registeredBy: payment.registeredBy,
    paidAt: payment.paidAt,
  };
}

// R4: con efectivo el cambio lo calcula el servidor contra el total que el mismo recalculo; sin efectivo no
// se guarda ni recibido ni cambio (CHECK de pareja en payments).
function settleAmount(method, total, amountReceived) {
  if (!method.isCash) {
    if (amountReceived !== undefined) {
      throw validationError('El monto recibido solo aplica a pagos en efectivo', {
        field: 'amountReceived',
      });
    }
    return { amountReceived: null, changeGiven: null };
  }
  if (amountReceived === undefined) {
    throw validationError('Escribe el monto recibido en efectivo', { field: 'amountReceived' });
  }
  if (amountReceived < total) {
    throw new AppError({
      status: 400,
      code: 'INSUFFICIENT_AMOUNT',
      message: 'El monto recibido no alcanza para el total',
      details: { total, amountReceived },
    });
  }
  return { amountReceived, changeGiven: amountReceived - total };
}

// GC-ORD-0008. Registra el pago de una orden EN_COBRO y la cierra; la mesa queda libre. La venta sigue
// atribuida a openedBy; quien cobra queda en registeredBy.
export async function registerPayment(orderId, { paymentMethodId, amountReceived }, user) {
  const order = await loadOwnedOrder(orderId, user);
  if (order.status === 'CERRADA') throw invalidTransition('La orden ya fue pagada');
  if (order.status !== 'EN_COBRO') {
    throw invalidTransition('Solo se puede cobrar una mesa en cobro');
  }

  const pending = liveItems(order);
  if (pending.length > 0) {
    throw invalidTransition('Hay ítems sin entregar: entrégalos o cancélalos antes de cobrar', {
      items: pending,
    });
  }

  const method = await findPaymentMethodById(paymentMethodId);
  if (!method) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'El método de pago no existe' });
  }
  if (!method.isActive) {
    throw new AppError({
      status: 409,
      code: 'PAYMENT_METHOD_INACTIVE',
      message: 'El método de pago está inactivo',
    });
  }

  // La misma funcion que la cuenta (snapshot R3, sin cancelados, menos el descuento vigente)
  const bill = toBill(order);
  const settled = settleAmount(method, bill.total, amountReceived);

  const result = await closeOrderWithPayment({
    orderId,
    tableId: order.tableId,
    userId: user.userId,
    payment: {
      paymentMethodId,
      subtotal: bill.subtotal,
      discountAmount: bill.discountAmount,
      discountAppliedBy: bill.discountAmount > 0 ? order.discountAppliedBy : null,
      total: bill.total,
      ...settled,
    },
    auditDetails: {
      tableNumber: order.table.tableNumber,
      paymentMethodId,
      paymentMethod: method.name,
      subtotal: bill.subtotal,
      discountAmount: bill.discountAmount,
      total: bill.total,
      amountReceived: settled.amountReceived,
      changeGiven: settled.changeGiven,
    },
  });

  if (!result) {
    // Otro dispositivo cobro, cancelo el cobro o cambio el descuento entre la lectura y la escritura
    const fresh = await findOrderForBill(orderId);
    if (fresh?.status === 'CERRADA') throw invalidTransition('La orden ya fue pagada');
    if (fresh?.status !== 'EN_COBRO') throw invalidTransition('La mesa ya no está en cobro');
    throw invalidTransition('La cuenta cambió mientras cobrabas; revísala e inténtalo de nuevo');
  }

  // El pago ya esta guardado: si falla un aviso en tiempo real no se deshace ni se responde error
  try {
    const tableStatus = await getTableStatus(order.tableId);
    if (tableStatus) emitTableStatusChanged(tableStatus);
    emitOrderUpdated(
      {
        orderId,
        tableNumber: order.table.tableNumber,
        status: 'CERRADA',
        discountAmount: bill.discountAmount,
      },
      order.waiterId,
    );
  } catch (err) {
    console.error('No se pudo emitir el aviso del pago', err);
  }

  return toPayment(result.payment);
}
