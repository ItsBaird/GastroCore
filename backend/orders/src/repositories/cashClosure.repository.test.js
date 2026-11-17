// La confirmacion del cierre va en una sola transaccion: candado del dia, comprobacion de dia ya cerrado, calculo
// con las mismas consultas de la vista previa, escritura de cierre + desgloses y auditoria.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tx = {
  $executeRaw: vi.fn(),
  cashClosure: { findUnique: vi.fn(), create: vi.fn() },
  auditLog: { create: vi.fn() },
};
const prisma = { $transaction: vi.fn((fn) => fn(tx)) };
vi.mock('../config/prisma.js', () => ({ prisma }));
vi.mock('./reports.repository.js', () => ({
  findPaymentsOfDay: vi.fn(),
  findSoldItemsOfDay: vi.fn(),
}));

const reports = await import('./reports.repository.js');
const { confirmClosure } = await import('./cashClosure.repository.js');

const RANGE = {
  start: new Date('2026-11-14T05:00:00Z'),
  end: new Date('2026-11-15T05:00:00Z'),
};
const PREVIEW = {
  date: '2026-11-14',
  totalSales: 100000,
  tablesServed: 2,
  averageTicket: 50000,
  paymentBreakdown: [{ paymentMethodId: 'm1', totalAmount: 100000, paymentCount: 2 }],
  topProducts: [{ rank: 1, productId: 'p1', productName: 'Pizza', quantitySold: 4 }],
  waiterBreakdown: [{ waiterId: 'w1', totalAmount: 100000 }],
};
const PAYMENTS = [{ total: 1 }];
const ITEMS = [{ quantity: 1 }];

let build;
const run = () => confirmClosure({ date: '2026-11-14', range: RANGE, userId: 'admin-1', build });

beforeEach(() => {
  vi.resetAllMocks();
  prisma.$transaction.mockImplementation((fn) => fn(tx));
  tx.$executeRaw.mockResolvedValue(1);
  tx.cashClosure.findUnique.mockResolvedValue(null);
  tx.cashClosure.create.mockImplementation(async ({ data }) => ({
    closureId: 'c1',
    confirmedAt: new Date('2026-11-14T23:00:00Z'),
    ...data,
  }));
  tx.auditLog.create.mockResolvedValue({});
  reports.findPaymentsOfDay.mockResolvedValue(PAYMENTS);
  reports.findSoldItemsOfDay.mockResolvedValue(ITEMS);
  build = vi.fn(() => PREVIEW);
});

describe('confirmClosure', () => {
  it('calcula DENTRO de la transaccion (pasa tx a las consultas) y guarda el consolidado con sus desgloses', async () => {
    const out = await run();

    expect(reports.findPaymentsOfDay).toHaveBeenCalledWith(RANGE, tx);
    expect(reports.findSoldItemsOfDay).toHaveBeenCalledWith(RANGE, tx);
    expect(build).toHaveBeenCalledWith({ payments: PAYMENTS, items: ITEMS });

    expect(tx.cashClosure.create).toHaveBeenCalledWith({
      data: {
        closureDate: new Date('2026-11-14T00:00:00Z'),
        totalSales: 100000,
        tablesServed: 2,
        averageTicket: 50000,
        confirmedBy: 'admin-1',
        paymentBreakdown: {
          create: [{ paymentMethodId: 'm1', totalAmount: 100000, paymentCount: 2 }],
        },
        topProducts: {
          create: [{ rank: 1, productId: 'p1', productNameSnapshot: 'Pizza', quantitySold: 4 }],
        },
        waiterBreakdown: { create: [{ waiterId: 'w1', totalAmount: 100000 }] },
      },
    });
    expect(out.preview).toBe(PREVIEW);
    expect(out.closure).toMatchObject({ closureId: 'c1', confirmedBy: 'admin-1' });
  });

  it('audita CASH_CLOSE_CONFIRMED con quien, cuando (performed_at) y cuanto', async () => {
    await run();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actionType: 'CASH_CLOSE_CONFIRMED',
        entityType: 'cash_closure',
        entityId: 'c1',
        performedBy: 'admin-1',
        details: { date: '2026-11-14', totalSales: 100000, tablesServed: 2, averageTicket: 50000 },
      },
    });
  });

  it('toma el candado del dia antes de comprobar el cierre, y este antes de leer y escribir', async () => {
    const order = [];
    tx.$executeRaw.mockImplementation(async () => order.push('lock'));
    tx.cashClosure.findUnique.mockImplementation(async () => {
      order.push('check');
      return null;
    });
    reports.findPaymentsOfDay.mockImplementation(async () => {
      order.push('read');
      return PAYMENTS;
    });
    tx.cashClosure.create.mockImplementation(async ({ data }) => {
      order.push('write');
      return { closureId: 'c1', confirmedAt: new Date(), ...data };
    });
    await run();
    expect(order).toEqual(['lock', 'check', 'read', 'write']);
  });

  it('dia ya cerrado: { alreadyClosed: true } y no calcula, ni escribe, ni audita', async () => {
    tx.cashClosure.findUnique.mockResolvedValue({ closureId: 'c0' });
    expect(await run()).toEqual({ alreadyClosed: true });
    expect(build).not.toHaveBeenCalled();
    expect(tx.cashClosure.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('choque con el UNIQUE uq_closures_date (P2002) se trata como dia ya cerrado', async () => {
    tx.cashClosure.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    expect(await run()).toEqual({ alreadyClosed: true });
  });

  it('un dia sin ventas se guarda con ceros y listas vacias', async () => {
    build.mockReturnValue({
      date: '2026-11-14',
      totalSales: 0,
      tablesServed: 0,
      averageTicket: 0,
      paymentBreakdown: [],
      topProducts: [],
      waiterBreakdown: [],
    });
    await run();
    const data = tx.cashClosure.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ totalSales: 0, tablesServed: 0, averageTicket: 0 });
    expect(data.paymentBreakdown.create).toEqual([]);
    expect(data.topProducts.create).toEqual([]);
    expect(data.waiterBreakdown.create).toEqual([]);
  });

  it('cualquier otro error (por ejemplo la auditoria) sale de la transaccion: Prisma revierte todo', async () => {
    tx.auditLog.create.mockRejectedValue(new Error('audit failed'));
    await expect(run()).rejects.toThrow('audit failed');
  });
});
