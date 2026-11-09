// El cierre de la orden, el pago, el rechazo de solicitudes QR y la auditoria van en una sola transaccion:
// si algo falla el error sale del callback de $transaction y Prisma hace ROLLBACK.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tx = {
  order: { updateMany: vi.fn() },
  payment: { create: vi.fn() },
  qrRequest: { updateMany: vi.fn() },
  auditLog: { create: vi.fn() },
};
const prisma = { $transaction: vi.fn((fn) => fn(tx)) };
vi.mock('../config/prisma.js', () => ({ prisma }));

const { closeOrderWithPayment } = await import('./payment.repository.js');

const PAYMENT = {
  paymentMethodId: 'm-cash',
  subtotal: 115000,
  discountAmount: 15000,
  discountAppliedBy: 'admin-1',
  total: 100000,
  amountReceived: 120000,
  changeGiven: 20000,
};
const input = {
  orderId: 'o1',
  userId: 'waiter-1',
  payment: PAYMENT,
  auditDetails: { tableNumber: 7, paymentMethod: 'Efectivo', total: 100000 },
};

beforeEach(() => {
  vi.resetAllMocks();
  prisma.$transaction.mockImplementation((fn) => fn(tx));
  tx.order.updateMany.mockResolvedValue({ count: 1 });
  tx.payment.create.mockImplementation(async ({ data }) => ({ paymentId: 'pay-1', ...data }));
  tx.qrRequest.updateMany.mockResolvedValue({ count: 0 });
  tx.auditLog.create.mockResolvedValue({});
});

describe('closeOrderWithPayment', () => {
  it('cierra condicionado a lo leido, registra el pago con closedAt = paidAt y audita', async () => {
    const result = await closeOrderWithPayment(input);

    const closeArgs = tx.order.updateMany.mock.calls[0][0];
    expect(closeArgs.where).toEqual({
      orderId: 'o1',
      status: 'EN_COBRO',
      discountAmount: 15000,
      payment: { is: null },
      rounds: {
        none: { items: { some: { status: { in: ['pendiente', 'en_preparacion', 'listo'] } } } },
      },
    });
    expect(closeArgs.data).toEqual({ status: 'CERRADA', closedAt: expect.any(Date) });

    const paymentData = tx.payment.create.mock.calls[0][0].data;
    expect(paymentData).toEqual({
      orderId: 'o1',
      ...PAYMENT,
      registeredBy: 'waiter-1',
      paidAt: closeArgs.data.closedAt,
    });

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actionType: 'PAYMENT_REGISTERED',
        entityType: 'order',
        entityId: 'o1',
        performedBy: 'waiter-1',
        details: { tableNumber: 7, paymentMethod: 'Efectivo', total: 100000, paymentId: 'pay-1' },
      },
    });
    expect(result).toEqual({
      payment: expect.objectContaining({ paymentId: 'pay-1' }),
      rejectedQrRequests: 0,
    });
  });

  it('rechaza las solicitudes QR pendientes de la orden con resolvedBy y resolvedAt', async () => {
    tx.qrRequest.updateMany.mockResolvedValue({ count: 2 });

    const result = await closeOrderWithPayment(input);

    expect(tx.qrRequest.updateMany).toHaveBeenCalledWith({
      where: { orderId: 'o1', status: 'pendiente' },
      data: { status: 'rechazada', resolvedBy: 'waiter-1', resolvedAt: expect.any(Date) },
    });
    expect(tx.auditLog.create.mock.calls[0][0].data.details.rejectedQrRequests).toBe(2);
    expect(result.rejectedQrRequests).toBe(2);
  });

  it('0 filas (otro cobro, cobro cancelado o descuento cambiado): null sin pago ni auditoria', async () => {
    tx.order.updateMany.mockResolvedValue({ count: 0 });

    await expect(closeOrderWithPayment(input)).resolves.toBeNull();
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(tx.qrRequest.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it.each([
    ['el pago', () => tx.payment.create.mockRejectedValue(new Error('chk_payments_change'))],
    ['la auditoria', () => tx.auditLog.create.mockRejectedValue(new Error('chk_payments_change'))],
  ])(
    'si falla %s el error sale de la transaccion (Prisma revierte el cierre)',
    async (_l, fail) => {
      fail();
      await expect(closeOrderWithPayment(input)).rejects.toThrow('chk_payments_change');
    },
  );
});
