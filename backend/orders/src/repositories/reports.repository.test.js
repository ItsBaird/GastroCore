// Los filtros del reporte son la regla de negocio: qué órdenes entran al cierre de caja. Aquí se comprueba el
// WHERE exacto que se le manda a Prisma (la consulta real se verifico contra PostgreSQL al implementarla).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = {
  payment: { findMany: vi.fn() },
  orderItem: { findMany: vi.fn() },
};
vi.mock('../config/prisma.js', () => ({ prisma }));

const { findPaymentsOfDay, findSoldItemsOfDay } = await import('./reports.repository.js');

const RANGE = {
  start: new Date('2026-11-14T05:00:00.000Z'),
  end: new Date('2026-11-15T05:00:00.000Z'),
};

beforeEach(() => {
  vi.resetAllMocks();
  prisma.payment.findMany.mockResolvedValue([]);
  prisma.orderItem.findMany.mockResolvedValue([]);
});

describe('findPaymentsOfDay', () => {
  it('solo pagos de ordenes CERRADA cuyo cierre cae en [start, end): el fin es exclusivo', async () => {
    await findPaymentsOfDay(RANGE);
    const { where } = prisma.payment.findMany.mock.calls[0][0];
    expect(where).toEqual({
      order: { status: 'CERRADA', closedAt: { gte: RANGE.start, lt: RANGE.end } },
    });
  });

  it('pide solo lo necesario: total, metodo y el mesero que abrio la mesa', async () => {
    await findPaymentsOfDay(RANGE);
    const { select } = prisma.payment.findMany.mock.calls[0][0];
    expect(select).toEqual({
      total: true,
      paymentMethodId: true,
      order: { select: { openedBy: true } },
    });
  });

  it('devuelve lo que entrega la base', async () => {
    const rows = [{ total: 1000, paymentMethodId: 'm', order: { openedBy: 'w' } }];
    prisma.payment.findMany.mockResolvedValue(rows);
    expect(await findPaymentsOfDay(RANGE)).toBe(rows);
  });
});

describe('findSoldItemsOfDay', () => {
  it('excluye los items cancelados y toma solo ordenes CERRADA cerradas en el dia', async () => {
    await findSoldItemsOfDay(RANGE);
    const { where } = prisma.orderItem.findMany.mock.calls[0][0];
    expect(where).toEqual({
      status: { not: 'cancelado' },
      round: { order: { status: 'CERRADA', closedAt: { gte: RANGE.start, lt: RANGE.end } } },
    });
  });

  it('pide el snapshot del nombre y del precio (R3), no el catalogo actual', async () => {
    await findSoldItemsOfDay(RANGE);
    const { select } = prisma.orderItem.findMany.mock.calls[0][0];
    expect(select).toEqual({
      productId: true,
      productNameSnapshot: true,
      quantity: true,
      unitPriceSnapshot: true,
      createdAt: true,
    });
  });
});

describe('atribucion por mesero (GC-151)', () => {
  it('de la orden solo pide openedBy: NO waiterId (cambia al reasignar la mesa) ni el que registro el pago', async () => {
    await findPaymentsOfDay(RANGE);
    const { select } = prisma.payment.findMany.mock.calls[0][0];
    expect(Object.keys(select.order.select)).toEqual(['openedBy']);
    expect(select).not.toHaveProperty('registeredBy');
  });
});
