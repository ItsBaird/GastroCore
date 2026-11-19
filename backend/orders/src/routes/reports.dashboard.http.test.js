// GC-RPT-0004 (GC-201). Dashboard con la app real (rutas, JWT, validacion, errores, cabeceras). El repositorio y
// Catalog van simulados; el SQL se verifica contra PostgreSQL con src/test/dashboard.db.check.js.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../repositories/dashboard.repository.js';
import { call, startApp, tokenFor } from '../test/helpers.js';

vi.mock('../config/prisma.js', () => ({ prisma: {} }));
vi.mock('../repositories/dashboard.repository.js');
vi.mock('../clients/catalogClient.js', () => ({ catalogClient: { getProductsByIds: vi.fn() } }));

const { catalogClient } = await import('../clients/catalogClient.js');

const URL = '/api/orders/reports/dashboard';
const W1 = '33333333-3333-4333-8333-333333333333';
const W2 = '44444444-4444-4444-8444-444444444444';
const M1 = '11111111-1111-4111-8111-111111111111';
const M2 = '22222222-2222-4222-8222-222222222222';
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const C1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

let app;
const get = (query = '', token = tokenFor('ADMIN')) =>
  call(app.base, 'GET', `${URL}${query}`, { token });

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  repo.salesTotals.mockResolvedValue({ sales: 0, orders: 0 });
  repo.salesByDay.mockResolvedValue([]);
  repo.salesByHour.mockResolvedValue([]);
  repo.salesByWaiter.mockResolvedValue([]);
  repo.salesByPaymentMethod.mockResolvedValue([]);
  repo.soldProducts.mockResolvedValue([]);
  repo.preparationByProduct.mockResolvedValue([]);
});

describe('acceso: solo el ADMIN', () => {
  it('sin sesion -> 401', async () => {
    expect((await get('', null)).status).toBe(401);
    expect(repo.salesTotals).not.toHaveBeenCalled();
  });

  it.each(['WAITER', 'COOK'])('un %s -> 403 sin consultar nada', async (role) => {
    const res = await get('', tokenFor(role));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(repo.salesTotals).not.toHaveBeenCalled();
  });
});

describe('validacion del periodo -> 400 VALIDATION_ERROR con el campo y un mensaje claro', () => {
  it.each([
    ['?from=2026-01-01&to=2026-04-03', 'to', 'El rango máximo es de 92 días'],
    ['?from=2026-11-12&to=2026-11-10', 'to', 'La fecha final no puede ser anterior a la inicial'],
    ['?from=2026-11-10', 'to', 'Indica las dos fechas del periodo (desde y hasta) o ninguna'],
    ['?from=2026-02-30&to=2026-03-01', 'from', 'La fecha no existe en el calendario'],
  ])('%s', async (query, path, message) => {
    const res = await get(query);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields).toEqual([{ path, message }]);
    expect(repo.salesTotals).not.toHaveBeenCalled();
  });

  it('parametro desconocido -> 400', async () => {
    expect((await get('?from=2026-11-10&to=2026-11-10&waiterId=x')).status).toBe(400);
  });

  it('92 dias exactos -> 200', async () => {
    const res = await get('?from=2026-01-01&to=2026-04-02');
    expect(res.status).toBe(200);
    expect(res.body.salesByDay).toHaveLength(92);
  });
});

describe('GET /api/orders/reports/dashboard', () => {
  it('cuerpo del contrato, no-store y desgloses que suman las ventas', async () => {
    repo.salesTotals
      .mockResolvedValueOnce({ sales: 150000, orders: 3 })
      .mockResolvedValueOnce({ sales: 100000, orders: 2 });
    repo.salesByDay.mockResolvedValue([
      { date: '2026-11-10', totalSales: 90000, orders: 2 },
      { date: '2026-11-11', totalSales: 60000, orders: 1 },
    ]);
    repo.salesByHour.mockResolvedValue([
      { hour: 13, totalSales: 90000, orders: 2 },
      { hour: 20, totalSales: 60000, orders: 1 },
    ]);
    repo.salesByWaiter.mockResolvedValue([
      { waiterId: W2, totalAmount: 60000, ordersCount: 1 },
      { waiterId: W1, totalAmount: 90000, ordersCount: 2 },
    ]);
    repo.salesByPaymentMethod.mockResolvedValue([
      { paymentMethodId: M1, totalAmount: 100000, paymentCount: 2 },
      { paymentMethodId: M2, totalAmount: 50000, paymentCount: 1 },
    ]);
    repo.soldProducts.mockResolvedValue([
      { productId: P1, productName: 'Pizza', quantitySold: 5, revenue: 160000 },
    ]);
    repo.preparationByProduct
      .mockResolvedValueOnce([{ productId: P1, items: 4, seconds: 4 * 750, discarded: 0 }]) // 12,5 min
      .mockResolvedValueOnce([]);
    catalogClient.getProductsByIds.mockResolvedValue([
      {
        productId: P1,
        name: 'Pizza',
        price: 32000,
        isAvailable: true,
        categoryId: C1,
        categoryName: 'Pizzas',
      },
    ]);

    const raw = await fetch(`${app.base}${URL}?from=2026-11-10&to=2026-11-11`, {
      headers: { Authorization: `Bearer ${tokenFor('ADMIN')}` },
    });
    const body = await raw.json();

    expect(raw.status).toBe(200);
    expect(raw.headers.get('cache-control')).toBe('no-store');
    expect(Object.keys(body).sort()).toEqual(
      [
        'kpis',
        'paymentBreakdown',
        'period',
        'preparation',
        'previousPeriod',
        'salesByDay',
        'salesByHour',
        'topProducts',
        'waiterBreakdown',
      ].sort(),
    );
    expect(body.period).toEqual({ from: '2026-11-10', to: '2026-11-11' });
    expect(body.previousPeriod).toEqual({ from: '2026-11-08', to: '2026-11-09' });
    expect(body.kpis).toEqual({
      sales: { value: 150000, previous: 100000, changePercent: 50 },
      orders: { value: 3, previous: 2, changePercent: 50 },
      averageTicket: { value: 50000, previous: 50000, changePercent: 0 },
      preparationMinutes: { value: 12.5, previous: null, changePercent: null },
    });
    expect(body.preparation.byCategory).toEqual([
      { categoryId: C1, categoryName: 'Pizzas', averageMinutes: 12.5, itemsMeasured: 4 },
    ]);
    expect(body.topProducts).toEqual([
      { rank: 1, productId: P1, productName: 'Pizza', quantitySold: 5, revenue: 160000 },
    ]);
    expect(body.waiterBreakdown.map((w) => w.waiterId)).toEqual([W1, W2]);
    const sum = (rows, key) => rows.reduce((s, r) => s + r[key], 0);
    for (const [rows, key] of [
      [body.salesByDay, 'totalSales'],
      [body.salesByHour, 'totalSales'],
      [body.waiterBreakdown, 'totalAmount'],
      [body.paymentBreakdown, 'totalAmount'],
    ]) {
      expect(sum(rows, key)).toBe(body.kpis.sales.value);
    }
  });

  it('periodo sin ventas: 200 con ceros y arreglos completos', async () => {
    const res = await get('?from=2026-12-01&to=2026-12-07');
    expect(res.status).toBe(200);
    expect(res.body.salesByDay).toHaveLength(7);
    expect(res.body.salesByHour).toHaveLength(24);
    expect(res.body.kpis.sales).toEqual({ value: 0, previous: 0, changePercent: null });
    expect(res.text).not.toMatch(/NaN|Infinity/);
  });
});
