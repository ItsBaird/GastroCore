// La correccion va en una sola transaccion: candado del dia de la venta, cambio condicionado y auditoria.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tx = {
  $executeRaw: vi.fn(),
  cashClosure: { findUnique: vi.fn() },
  payment: { updateMany: vi.fn(), findUnique: vi.fn() },
  auditLog: { create: vi.fn() },
};
const prisma = { $transaction: vi.fn((fn) => fn(tx)) };
vi.mock('../config/prisma.js', () => ({ prisma }));

const { correctPaymentMethod } = await import('./paymentCorrection.repository.js');

const input = {
  orderId: 'o1',
  paymentId: 'pay-1',
  closedAt: new Date('2026-11-15T01:00:00Z'), // 20:00 del 14-nov en Colombia
  userId: 'admin-1',
  expectedMethodId: 'm-cash',
  update: { paymentMethodId: 'm-card', amountReceived: null, changeGiven: null },
  auditDetails: { paymentId: 'pay-1', total: 90000, reason: 'Error al digitar' },
};

beforeEach(() => {
  vi.resetAllMocks();
  prisma.$transaction.mockImplementation((fn) => fn(tx));
  tx.$executeRaw.mockResolvedValue(1);
  tx.cashClosure.findUnique.mockResolvedValue(null);
  tx.payment.updateMany.mockResolvedValue({ count: 1 });
  tx.payment.findUnique.mockResolvedValue({ paymentId: 'pay-1', paymentMethodId: 'm-card' });
  tx.auditLog.create.mockResolvedValue({});
});

describe('correctPaymentMethod', () => {
  it('actualiza condicionado al metodo leido y devuelve el pago corregido', async () => {
    const out = await correctPaymentMethod(input);
    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { paymentId: 'pay-1', paymentMethodId: 'm-cash' },
      data: input.update,
    });
    expect(out.payment).toEqual({ paymentId: 'pay-1', paymentMethodId: 'm-card' });
  });

  it('toma el candado del dia de la VENTA (UTC-5) y consulta ese cierre', async () => {
    await correctPaymentMethod(input);
    expect(tx.cashClosure.findUnique).toHaveBeenCalledWith({
      where: { closureDate: new Date('2026-11-14T00:00:00Z') },
      select: { closureId: true },
    });
  });

  it('candado -> cierre -> escritura, en ese orden', async () => {
    const order = [];
    tx.$executeRaw.mockImplementation(async () => order.push('lock'));
    tx.cashClosure.findUnique.mockImplementation(async () => {
      order.push('check');
      return null;
    });
    tx.payment.updateMany.mockImplementation(async () => {
      order.push('write');
      return { count: 1 };
    });
    await correctPaymentMethod(input);
    expect(order).toEqual(['lock', 'check', 'write']);
  });

  it('audita PAYMENT_METHOD_CORRECTED sobre la orden, con quien, y postClosure=false si el dia no esta cerrado', async () => {
    await correctPaymentMethod(input);
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actionType: 'PAYMENT_METHOD_CORRECTED',
        entityType: 'order',
        entityId: 'o1',
        performedBy: 'admin-1',
        details: {
          paymentId: 'pay-1',
          total: 90000,
          reason: 'Error al digitar',
          postClosure: false,
        },
      },
    });
  });

  it('con el dia ya cerrado marca postClosure=true y el dia del cierre', async () => {
    tx.cashClosure.findUnique.mockResolvedValue({ closureId: 'c1' });
    await correctPaymentMethod(input);
    expect(tx.auditLog.create.mock.calls[0][0].data.details).toMatchObject({
      postClosure: true,
      closureDate: '2026-11-14',
    });
  });

  it('si el metodo ya no era el leido (otra correccion): { changed: true } y no audita', async () => {
    tx.payment.updateMany.mockResolvedValue({ count: 0 });
    expect(await correctPaymentMethod(input)).toEqual({ changed: true });
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('si falla la auditoria el error sale de la transaccion (Prisma revierte el cambio)', async () => {
    tx.auditLog.create.mockRejectedValue(new Error('audit failed'));
    await expect(correctPaymentMethod(input)).rejects.toThrow('audit failed');
  });
});
