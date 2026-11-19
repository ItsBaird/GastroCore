import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../repositories/reports.repository.js');

const repo = await import('../repositories/reports.repository.js');
const { getCashClosePreview } = await import('./cashClose.service.js');

beforeEach(() => {
  vi.resetAllMocks();
  repo.findPaymentsOfDay.mockResolvedValue([]);
  repo.findSoldItemsOfDay.mockResolvedValue([]);
});

describe('getCashClosePreview', () => {
  it('consulta pagos e items del dia de negocio (UTC-5) de la fecha pedida', async () => {
    await getCashClosePreview('2026-11-14');
    const expected = {
      start: new Date('2026-11-14T05:00:00.000Z'),
      end: new Date('2026-11-15T05:00:00.000Z'),
    };
    expect(repo.findPaymentsOfDay).toHaveBeenCalledWith(expected);
    expect(repo.findSoldItemsOfDay).toHaveBeenCalledWith(expected);
  });

  it('un dia sin ordenes responde ceros y listas vacias, no un error', async () => {
    expect(await getCashClosePreview('2026-11-14')).toEqual({
      date: '2026-11-14',
      totalSales: 0,
      tablesServed: 0,
      averageTicket: 0,
      paymentBreakdown: [],
      topProducts: [],
      waiterBreakdown: [],
    });
  });

  it('calcula el consolidado con lo que devuelve el repositorio', async () => {
    repo.findPaymentsOfDay.mockResolvedValue([
      { total: 30000, paymentMethodId: 'm1', order: { openedBy: 'w1' } },
      { total: 10000, paymentMethodId: 'm2', order: { openedBy: 'w1' } },
    ]);
    repo.findSoldItemsOfDay.mockResolvedValue([
      {
        productId: 'p1',
        productNameSnapshot: 'Pizza',
        quantity: 2,
        unitPriceSnapshot: 20000,
        createdAt: new Date('2026-11-14T15:00:00Z'),
      },
    ]);
    const out = await getCashClosePreview('2026-11-14');
    expect(out).toMatchObject({ totalSales: 40000, tablesServed: 2, averageTicket: 20000 });
    expect(out.paymentBreakdown).toHaveLength(2);
    expect(out.topProducts).toEqual([
      { rank: 1, productId: 'p1', productName: 'Pizza', quantitySold: 2 },
    ]);
    expect(out.waiterBreakdown).toEqual([{ waiterId: 'w1', totalAmount: 40000 }]);
  });

  it('un error de la base se propaga', async () => {
    const boom = new Error('db caida');
    repo.findPaymentsOfDay.mockRejectedValue(boom);
    await expect(getCashClosePreview('2026-11-14')).rejects.toBe(boom);
  });
});
