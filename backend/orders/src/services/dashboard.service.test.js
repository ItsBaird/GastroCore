import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/prisma.js', () => ({ prisma: {} }));
vi.mock('../repositories/dashboard.repository.js');
vi.mock('../clients/catalogClient.js', () => ({ catalogClient: { getProductsByIds: vi.fn() } }));

const repo = await import('../repositories/dashboard.repository.js');
const { catalogClient } = await import('../clients/catalogClient.js');
const { getDashboard, resolveCategories } = await import('./dashboard.service.js');

const P1 = '00000000-0000-4000-a000-000000000001';
const P2 = '00000000-0000-4000-a000-000000000002';
const NOW = new Date('2026-11-18T17:00:00Z'); // miercoles: semana del 16 al 22

beforeEach(() => {
  vi.resetAllMocks();
  repo.salesTotals.mockResolvedValue({ sales: 0, orders: 0 });
  repo.salesByDay.mockResolvedValue([]);
  repo.salesByHour.mockResolvedValue([]);
  repo.salesByWaiter.mockResolvedValue([]);
  repo.salesByPaymentMethod.mockResolvedValue([]);
  repo.soldProducts.mockResolvedValue([]);
  repo.preparationByProduct.mockResolvedValue([]);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('getDashboard', () => {
  it('sin rango consulta la semana en curso y la anterior, con los instantes UTC del dia de negocio', async () => {
    const d = await getDashboard({}, NOW);

    expect(d.period).toEqual({ from: '2026-11-16', to: '2026-11-22' });
    expect(d.previousPeriod).toEqual({ from: '2026-11-09', to: '2026-11-15' });
    const current = {
      start: new Date('2026-11-16T05:00:00Z'),
      end: new Date('2026-11-23T05:00:00Z'),
    };
    const previous = {
      start: new Date('2026-11-09T05:00:00Z'),
      end: new Date('2026-11-16T05:00:00Z'),
    };
    expect(repo.salesTotals.mock.calls).toEqual([[current], [previous]]);
    expect(repo.preparationByProduct.mock.calls).toEqual([[current], [previous]]);
    expect(repo.salesByDay).toHaveBeenCalledWith(current);
    expect(d.salesByDay).toHaveLength(7);
  });

  it('usa el rango pedido; solo lectura: no consulta Catalog si no hay items medidos', async () => {
    const d = await getDashboard({ from: '2026-11-10', to: '2026-11-10' }, NOW);
    expect(d.previousPeriod).toEqual({ from: '2026-11-09', to: '2026-11-09' });
    expect(catalogClient.getProductsByIds).not.toHaveBeenCalled();
  });

  it('desglose por categoria con Catalog; items incoherentes no se miden y se registran sin datos sensibles', async () => {
    repo.preparationByProduct
      .mockResolvedValueOnce([
        { productId: P1, items: 2, seconds: 1800, discarded: 1 },
        { productId: P2, items: 0, seconds: 0, discarded: 1 },
      ])
      .mockResolvedValueOnce([]);
    catalogClient.getProductsByIds.mockResolvedValue([
      {
        productId: P1,
        name: 'Pizza',
        price: 1,
        isAvailable: true,
        categoryId: 'c1',
        categoryName: 'Pizzas',
      },
    ]);

    const d = await getDashboard({}, NOW);

    expect(catalogClient.getProductsByIds).toHaveBeenCalledWith([P1]);
    expect(d.preparation).toEqual({
      averageMinutes: 15,
      itemsMeasured: 2,
      byCategory: [
        { categoryId: 'c1', categoryName: 'Pizzas', averageMinutes: 15, itemsMeasured: 2 },
      ],
    });
    expect(console.warn).toHaveBeenCalledWith(
      'Dashboard: 2 items con ready_at anterior a su ronda no se midieron',
    );
  });

  it('Catalog caido o sin categoria: el promedio global sigue y byCategory es null', async () => {
    repo.preparationByProduct.mockResolvedValue([
      { productId: P1, items: 1, seconds: 600, discarded: 0 },
    ]);
    catalogClient.getProductsByIds.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'DEPENDENCY_UNAVAILABLE' }),
    );
    expect((await getDashboard({}, NOW)).preparation).toEqual({
      averageMinutes: 10,
      itemsMeasured: 1,
      byCategory: null,
    });

    // Catalog todavia sin categoryId en /internal/products
    catalogClient.getProductsByIds.mockResolvedValueOnce([
      { productId: P1, name: 'Pizza', price: 1, isAvailable: true },
    ]);
    expect((await getDashboard({}, NOW)).preparation.byCategory).toBeNull();
  });
});

describe('resolveCategories', () => {
  it('consulta Catalog en lotes de 100 ids', async () => {
    const ids = Array.from(
      { length: 205 },
      (_, i) => `00000000-0000-4000-a000-${String(i).padStart(12, '0')}`,
    );
    catalogClient.getProductsByIds.mockImplementation(async (batch) =>
      batch.map((productId) => ({ productId, categoryId: 'c', categoryName: 'C' })),
    );

    const map = await resolveCategories(ids);

    expect(catalogClient.getProductsByIds.mock.calls.map(([batch]) => batch.length)).toEqual([
      100, 100, 5,
    ]);
    expect(map.size).toBe(205);
  });
});
