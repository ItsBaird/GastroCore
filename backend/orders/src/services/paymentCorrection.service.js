import { AppError } from '../errors/AppError.js';
import {
  correctPaymentMethod,
  findPaymentOfOrder,
} from '../repositories/paymentCorrection.repository.js';
import { findPaymentMethodById } from '../repositories/paymentMethod.repository.js';
import { toPayment } from './payment.service.js';

const notFound = (message) => new AppError({ status: 404, code: 'NOT_FOUND', message });
const validationError = (message, details) =>
  new AppError({ status: 400, code: 'VALIDATION_ERROR', message, details });

// Mismas reglas de /pay (R4): con efectivo el cambio lo calcula el servidor contra el total YA guardado del pago;
// sin efectivo no se guarda ni recibido ni cambio (CHECK de pareja en payments).
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

// GC-RPT-0002 (GC-157), REQ-F10-04. Correccion del metodo de pago de una venta ya cobrada. Solo ADMIN (lo exige la
// ruta). Es la unica correccion: el total, el subtotal y el descuento no cambian. La auditoria dice quien, cuando
// (performed_at), que (metodo anterior y nuevo, motivo) y cuanto (total de la venta).
export async function correctOrderPaymentMethod(
  orderId,
  { paymentMethodId, amountReceived, reason },
  user,
) {
  const order = await findPaymentOfOrder(orderId);
  if (!order || !order.payment) throw notFound('La orden no existe o no tiene un pago registrado');
  if (order.status !== 'CERRADA') {
    throw new AppError({
      status: 409,
      code: 'INVALID_TRANSITION',
      message: 'Solo se corrige el pago de una orden cerrada',
    });
  }
  const { payment } = order;

  if (paymentMethodId === payment.paymentMethodId) {
    throw validationError('El pago ya tiene ese método de pago', { field: 'paymentMethodId' });
  }
  const method = await findPaymentMethodById(paymentMethodId);
  if (!method) throw notFound('El método de pago no existe');
  if (!method.isActive) {
    throw new AppError({
      status: 409,
      code: 'PAYMENT_METHOD_INACTIVE',
      message: 'El método de pago está inactivo',
    });
  }
  const previous = await findPaymentMethodById(payment.paymentMethodId);
  const settled = settleAmount(method, payment.total, amountReceived);

  const result = await correctPaymentMethod({
    orderId,
    paymentId: payment.paymentId,
    closedAt: order.closedAt,
    userId: user.userId,
    expectedMethodId: payment.paymentMethodId,
    update: { paymentMethodId, ...settled },
    auditDetails: {
      paymentId: payment.paymentId,
      previousMethodId: payment.paymentMethodId,
      previousMethod: previous?.name ?? null,
      newMethodId: paymentMethodId,
      newMethod: method.name,
      total: payment.total,
      previousAmountReceived: payment.amountReceived,
      previousChangeGiven: payment.changeGiven,
      amountReceived: settled.amountReceived,
      changeGiven: settled.changeGiven,
      reason,
    },
  });

  if (result.changed) {
    throw new AppError({
      status: 409,
      code: 'INVALID_TRANSITION',
      message: 'El pago cambió mientras lo corregías; revísalo e inténtalo de nuevo',
    });
  }
  return toPayment(result.payment);
}
