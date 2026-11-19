// La auditoria va en la misma transaccion que el descuento: si falla, la transaccion interactiva de Prisma
// se aborta (PostgreSQL revierte el UPDATE). Aqui se comprueba que el error sale del callback de
// $transaction, que es lo que hace que Prisma haga ROLLBACK.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tx = {
  order: { updateMany: vi.fn(), findUnique: vi.fn() },
  auditLog: { create: vi.fn() },
};
const prisma = { $transaction: vi.fn((fn) => fn(tx)) };
vi.mock('../config/prisma.js', () => ({ prisma }));

const { moveOrderBackToOpen, setOrderDiscount } = await import('./bill.repository.js');

beforeEach(() => {
  vi.resetAllMocks();
  prisma.$transaction.mockImplementation((fn) => fn(tx));
});

const base = {
  orderId: 'o1',
  previousAmount: 0,
  userId: 'admin-1',
  auditDetails: { newAmount: 5000 },
};

describe('setOrderDiscount', () => {
  it('actualiza condicionado al estado, al monto leido y a que no haya pago, y audita', async () => {
    tx.order.updateMany.mockResolvedValue({ count: 1 });

    await expect(setOrderDiscount({ ...base, amount: 5000 })).resolves.toBe(true);

    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { orderId: 'o1', status: 'EN_COBRO', discountAmount: 0, payment: { is: null } },
      data: {
        discountAmount: 5000,
        discountAppliedBy: 'admin-1',
        discountAppliedAt: expect.any(Date),
      },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actionType: 'DISCOUNT_APPLIED',
        entityType: 'order',
        entityId: 'o1',
        performedBy: 'admin-1',
        details: { newAmount: 5000 },
      },
    });
  });

  it('con 0 deja el trio en 0/null (CHECK chk_orders_discount_trio) y audita DISCOUNT_REMOVED', async () => {
    tx.order.updateMany.mockResolvedValue({ count: 1 });

    await setOrderDiscount({ ...base, previousAmount: 5000, amount: 0 });

    expect(tx.order.updateMany.mock.calls[0][0].data).toEqual({
      discountAmount: 0,
      discountAppliedBy: null,
      discountAppliedAt: null,
    });
    expect(tx.auditLog.create.mock.calls[0][0].data.actionType).toBe('DISCOUNT_REMOVED');
  });

  it('0 filas: no audita y devuelve false', async () => {
    tx.order.updateMany.mockResolvedValue({ count: 0 });

    await expect(setOrderDiscount({ ...base, amount: 5000 })).resolves.toBe(false);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('si la auditoria falla el error sale de la transaccion (Prisma revierte el descuento)', async () => {
    tx.order.updateMany.mockResolvedValue({ count: 1 });
    tx.auditLog.create.mockRejectedValue(new Error('audit_log no disponible'));

    await expect(setOrderDiscount({ ...base, amount: 5000 })).rejects.toThrow(
      'audit_log no disponible',
    );
  });
});

describe('moveOrderBackToOpen', () => {
  it('quita el descuento en la misma transaccion y lo audita con quien cancelo', async () => {
    tx.order.findUnique
      .mockResolvedValueOnce({ discountAmount: 5000, table: { tableNumber: 7 } })
      .mockResolvedValueOnce({ orderId: 'o1', status: 'ABIERTA', discountAmount: 0 });
    tx.order.updateMany.mockResolvedValue({ count: 1 });

    await moveOrderBackToOpen('o1', 'waiter-1');

    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { orderId: 'o1', status: 'EN_COBRO', payment: { is: null } },
      data: {
        status: 'ABIERTA',
        discountAmount: 0,
        discountAppliedBy: null,
        discountAppliedAt: null,
      },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actionType: 'DISCOUNT_REMOVED',
        performedBy: 'waiter-1',
        details: expect.objectContaining({
          previousAmount: 5000,
          newAmount: 0,
          reason: 'Cobro cancelado',
        }),
      }),
    });
  });

  it('sin descuento no deja fila de auditoria', async () => {
    tx.order.findUnique
      .mockResolvedValueOnce({ discountAmount: 0, table: { tableNumber: 7 } })
      .mockResolvedValueOnce({ orderId: 'o1', status: 'ABIERTA' });
    tx.order.updateMany.mockResolvedValue({ count: 1 });

    await moveOrderBackToOpen('o1', 'waiter-1');

    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
