// Historial de cierres y cierre por dia (GC-158) con la app real (rutas, JWT, validacion, errores).
// Solo el repositorio va simulado: no hace falta base de datos.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { findClosureByDate, listClosures } from '../repositories/cashClosureQuery.repository.js';
import { call, startApp, tokenFor } from '../test/helpers.js';

vi.mock('../config/prisma.js', () => ({ prisma: {} }));
vi.mock('../repositories/cashClosureQuery.repository.js', () => ({
  listClosures: vi.fn(),
  findClosureByDate: vi.fn(),
}));

const LIST = '/api/orders/reports/cash-closures';
const M1 = '11111111-1111-4111-8111-111111111111';
const W1 = '33333333-3333-4333-8333-333333333333';
const ADMIN_ID = '99999999-9999-4999-8999-999999999999';
const CONFIRMED_AT = new Date('2026-11-14T23:30:00Z');

const closure = (day, overrides = {}) => ({
  closureId: `cccccccc-cccc-4ccc-8ccc-${day.replaceAll('-', '').padStart(12, '0')}`,
  closureDate: new Date(`${day}T00:00:00Z`),
  totalSales: 80000,
  tablesServed: 2,
  averageTicket: 40000,
  confirmedBy: ADMIN_ID,
  confirmedAt: CONFIRMED_AT,
  paymentBreakdown: [{ paymentMethodId: M1, totalAmount: 80000, paymentCount: 2 }],
  topProducts: [
    {
      rank: 1,
      productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      productNameSnapshot: 'Pizza',
      quantitySold: 3,
    },
  ],
  waiterBreakdown: [{ waiterId: W1, totalAmount: 80000 }],
  ...overrides,
});

let app;
// Sin token: pasar null (un undefined activaria el valor por defecto, un token de ADMIN)
const get = (path, token = tokenFor('ADMIN')) => call(app.base, 'GET', path, { token });

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  listClosures.mockResolvedValue({ rows: [], total: 0 });
  findClosureByDate.mockResolvedValue(null);
});

describe.each([
  ['historial', LIST],
  ['cierre por dia', `${LIST}/2026-11-14`],
])('acceso (%s): solo el ADMIN', (_name, url) => {
  it('sin sesion -> 401', async () => {
    expect((await get(url, null)).status).toBe(401);
  });
  it.each(['WAITER', 'COOK'])('un %s -> 403', async (role) => {
    const res = await get(url, tokenFor(role));
    expect(res.status).toBe(403);
    expect(listClosures).not.toHaveBeenCalled();
    expect(findClosureByDate).not.toHaveBeenCalled();
  });
});

describe('GET /api/orders/reports/cash-closures', () => {
  it('lista los cierres con su resumen, el mas reciente primero (orden de la consulta) y el total', async () => {
    listClosures.mockResolvedValue({
      rows: [closure('2026-11-14'), closure('2026-11-13')],
      total: 12,
    });
    const res = await get(LIST);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(12);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(10);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0]).toEqual({
      closureId: expect.any(String),
      date: '2026-11-14',
      totalSales: 80000,
      tablesServed: 2,
      averageTicket: 40000,
      confirmedBy: ADMIN_ID,
      confirmedAt: CONFIRMED_AT.toISOString(),
    });
    expect(res.body.items[0]).not.toHaveProperty('paymentBreakdown');
  });

  it('sin cierres responde 200 con lista vacia', async () => {
    const res = await get(LIST);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], page: 1, pageSize: 10, total: 0 });
  });

  it('pagina: page=3&pageSize=5 salta 10 filas y toma 5', async () => {
    await get(`${LIST}?page=3&pageSize=5`);
    expect(listClosures).toHaveBeenCalledWith({ skip: 10, take: 5 });
  });

  it.each([
    ['page=0', '?page=0'],
    ['page negativa', '?page=-1'],
    ['page no numerica', '?page=abc'],
    ['pageSize=0', '?pageSize=0'],
    ['pageSize mayor al maximo', '?pageSize=51'],
    ['pageSize decimal', '?pageSize=2.5'],
    ['parametro desconocido', '?date=2026-11-14'],
  ])('400: %s', async (_label, query) => {
    const res = await get(`${LIST}${query}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(listClosures).not.toHaveBeenCalled();
  });
});

describe('GET /api/orders/reports/cash-closures/:date', () => {
  it('devuelve el cierre CONFIRMADO con sus desgloses (forma CashClose)', async () => {
    findClosureByDate.mockResolvedValue(closure('2026-11-14'));
    const res = await get(`${LIST}/2026-11-14`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      date: '2026-11-14',
      totalSales: 80000,
      tablesServed: 2,
      paymentBreakdown: [{ paymentMethodId: M1, totalAmount: 80000, paymentCount: 2 }],
      topProducts: [{ rank: 1, productName: 'Pizza', quantitySold: 3 }],
      waiterBreakdown: [{ waiterId: W1, totalAmount: 80000 }],
      confirmedBy: ADMIN_ID,
    });
    expect(findClosureByDate).toHaveBeenCalledWith('2026-11-14');
  });

  it('un dia sin cierre -> 404 NOT_FOUND con la fecha', async () => {
    const res = await get(`${LIST}/2026-11-14`);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', details: { date: '2026-11-14' } });
  });

  it.each(['ayer', '2026-1-5', '2026-02-30', '14-11-2026'])(
    'fecha invalida %s -> 400',
    async (date) => {
      const res = await get(`${LIST}/${date}`);
      expect(res.status).toBe(400);
      expect(findClosureByDate).not.toHaveBeenCalled();
    },
  );
});
