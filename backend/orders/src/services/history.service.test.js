// GC-RPT-0003 (GC-188). Reglas del servicio del historial; el repositorio va simulado.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../repositories/history.repository.js', () => ({
  findHistoryPage: vi.fn(),
  findHistoryOrder: vi.fn(),
  findHistoryForExport: vi.fn(),
  aggregateHistory: vi.fn(),
}));

const repo = await import('../repositories/history.repository.js');
const { getSalesHistory, getSalesHistoryOrder } = await import('./history.service.js');

const NOW = new Date('2026-11-15T01:00:00Z'); // 8:00 p. m. del 14-nov en Colombia (01:00 UTC del 15)
const base = { page: 1, pageSize: 20 };
const row = (orderId) => ({
  orderId,
  tableId: 't-1',
  openedBy: 'w-1',
  openedAt: new Date('2026-11-14T17:00:00Z'),
  closedAt: new Date('2026-11-14T19:00:00Z'),
  table: { tableNumber: 4 },
  payment: { subtotal: 30000, discountAmount: 0, total: 30000, paymentMethodId: 'm-1' },
  rounds: [{ items: [{ quantity: 2 }] }],
});

beforeEach(() => {
  vi.resetAllMocks();
  repo.findHistoryPage.mockResolvedValue([]);
  repo.aggregateHistory.mockResolvedValue({ totalSales: 0, ordersCount: 0 });
});

describe('getSalesHistory: rango de dias', () => {
  it('sin fechas usa el dia de negocio ACTUAL de Colombia (no el dia UTC)', async () => {
    await getSalesHistory(base, NOW);
    expect(repo.findHistoryPage.mock.calls[0][0]).toMatchObject({
      start: new Date('2026-11-14T05:00:00Z'),
      end: new Date('2026-11-15T05:00:00Z'),
    });
  });

  it('from..to incluye ambos dias completos: [from 00:00, to+1 00:00) hora de Colombia', async () => {
    await getSalesHistory({ ...base, from: '2026-11-01', to: '2026-11-14' }, NOW);
    expect(repo.findHistoryPage.mock.calls[0][0]).toMatchObject({
      start: new Date('2026-11-01T05:00:00Z'),
      end: new Date('2026-11-15T05:00:00Z'),
    });
  });
});

describe('getSalesHistory: filtros y paginacion', () => {
  it('pasa los mismos filtros a la pagina y al resumen (el resumen es de TODO el filtro)', async () => {
    const q = {
      ...base,
      from: '2026-11-14',
      to: '2026-11-14',
      waiterId: 'w',
      tableId: 't',
      paymentMethodId: 'm',
    };
    await getSalesHistory(q, NOW);
    const expected = {
      start: new Date('2026-11-14T05:00:00Z'),
      end: new Date('2026-11-15T05:00:00Z'),
      waiterId: 'w',
      tableId: 't',
      paymentMethodId: 'm',
    };
    expect(repo.aggregateHistory).toHaveBeenCalledWith(expected);
    expect(repo.findHistoryPage).toHaveBeenCalledWith({ ...expected, skip: 0, take: 20 });
  });

  it('la pagina 3 de 10 salta 20 filas y toma 10', async () => {
    await getSalesHistory({ page: 3, pageSize: 10 }, NOW);
    expect(repo.findHistoryPage.mock.calls[0][0]).toMatchObject({ skip: 20, take: 10 });
  });
});

describe('getSalesHistory: respuesta (HistoryPage)', () => {
  it('items, pagina, total del filtro y resumen con el ticket promedio redondeado', async () => {
    repo.findHistoryPage.mockResolvedValue([row('aaaaaaaa-0000-4000-8000-000000000001')]);
    repo.aggregateHistory.mockResolvedValue({ totalSales: 100000, ordersCount: 3 });

    const out = await getSalesHistory({ page: 2, pageSize: 1 }, NOW);

    expect(out.page).toBe(2);
    expect(out.pageSize).toBe(1);
    expect(out.total).toBe(3);
    expect(out.summary).toEqual({ totalSales: 100000, ordersCount: 3, averageTicket: 33333 });
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ reference: 'AAAAAA', tableNumber: 4, itemsCount: 2 });
  });

  it('sin ventas: lista vacia y resumen en ceros, no un error', async () => {
    expect(await getSalesHistory(base, NOW)).toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      summary: { totalSales: 0, ordersCount: 0, averageTicket: 0 },
    });
  });

  it('un error de la base se propaga', async () => {
    repo.aggregateHistory.mockRejectedValue(new Error('db down'));
    await expect(getSalesHistory(base, NOW)).rejects.toThrow('db down');
  });
});

describe('getSalesHistoryOrder (GC-189)', () => {
  it('devuelve el detalle de la venta con sus lineas', async () => {
    repo.findHistoryOrder.mockResolvedValue({
      ...row('bbbbbbbb-0000-4000-8000-000000000002'),
      payment: {
        subtotal: 30000,
        discountAmount: 0,
        total: 30000,
        paymentMethodId: 'm-1',
        amountReceived: null,
        changeGiven: null,
      },
      rounds: [
        {
          items: [
            {
              productId: 'p1',
              productNameSnapshot: 'Pizza',
              unitPriceSnapshot: 15000,
              quantity: 2,
            },
          ],
        },
      ],
    });
    const out = await getSalesHistoryOrder('bbbbbbbb-0000-4000-8000-000000000002');
    expect(repo.findHistoryOrder).toHaveBeenCalledWith('bbbbbbbb-0000-4000-8000-000000000002');
    expect(out).toMatchObject({
      reference: 'BBBBBB',
      itemsCount: 2,
      cashReceived: null,
      changeGiven: null,
    });
    expect(out.lines).toEqual([
      { productId: 'p1', productName: 'Pizza', quantity: 2, unitPrice: 15000, lineTotal: 30000 },
    ]);
  });

  it('si no existe o no esta CERRADA (el repositorio da null): 404 ORDER_NOT_FOUND', async () => {
    repo.findHistoryOrder.mockResolvedValue(null);
    await expect(getSalesHistoryOrder('x')).rejects.toMatchObject({
      status: 404,
      code: 'ORDER_NOT_FOUND',
    });
  });
});
