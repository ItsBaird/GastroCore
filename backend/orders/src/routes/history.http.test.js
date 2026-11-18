// GET /api/orders/history (GC-RPT-0003, GC-188) con la app real: roles, validacion, forma de la respuesta y que
// la ruta no la captura GET /api/orders/:orderId. Solo el repositorio va simulado.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { aggregateHistory, findHistoryPage } from '../repositories/history.repository.js';
import { call, startApp, tokenFor } from '../test/helpers.js';

vi.mock('../config/prisma.js', () => ({ prisma: {} }));
vi.mock('../repositories/history.repository.js', () => ({
  findHistoryPage: vi.fn(),
  findHistoryOrder: vi.fn(),
  findHistoryForExport: vi.fn(),
  aggregateHistory: vi.fn(),
}));

const URL = '/api/orders/history';
const ORDER = '3f9a1c7e-0b2d-4e5f-8a9b-1c2d3e4f5a6b';
const TABLE = '22222222-2222-4222-8222-222222222222';
const WAITER = '33333333-3333-4333-8333-333333333333';
const METHOD = '44444444-4444-4444-8444-444444444444';

let app;
// Sin token: pasar null (un undefined activaria el valor por defecto, un token de ADMIN)
const get = (query = '', token = tokenFor('ADMIN')) =>
  call(app.base, 'GET', `${URL}${query}`, { token });

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  findHistoryPage.mockResolvedValue([]);
  aggregateHistory.mockResolvedValue({ totalSales: 0, ordersCount: 0 });
});

describe('acceso: solo el ADMIN', () => {
  it('sin sesion -> 401', async () => {
    expect((await get('', null)).status).toBe(401);
    expect(findHistoryPage).not.toHaveBeenCalled();
  });

  it.each(['WAITER', 'COOK'])('un %s -> 403 y no consulta nada', async (role) => {
    const res = await get('', tokenFor(role));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(findHistoryPage).not.toHaveBeenCalled();
    expect(aggregateHistory).not.toHaveBeenCalled();
  });
});

describe('GET /api/orders/history', () => {
  it('responde HistoryPage: filas del contrato, total y resumen', async () => {
    findHistoryPage.mockResolvedValue([
      {
        orderId: ORDER,
        tableId: TABLE,
        openedBy: WAITER,
        openedAt: new Date('2026-11-14T17:00:00Z'),
        closedAt: new Date('2026-11-14T19:00:00Z'),
        table: { tableNumber: 7 },
        payment: { subtotal: 100000, discountAmount: 10000, total: 90000, paymentMethodId: METHOD },
        rounds: [{ items: [{ quantity: 2 }] }, { items: [{ quantity: 1 }] }],
      },
    ]);
    aggregateHistory.mockResolvedValue({ totalSales: 90000, ordersCount: 1 });

    const res = await get('?from=2026-11-14&to=2026-11-14');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        {
          orderId: ORDER,
          reference: '3F9A1C',
          tableId: TABLE,
          tableNumber: 7,
          waiterId: WAITER,
          openedAt: '2026-11-14T17:00:00.000Z',
          closedAt: '2026-11-14T19:00:00.000Z',
          itemsCount: 3,
          subtotal: 100000,
          discountAmount: 10000,
          total: 90000,
          paymentMethodId: METHOD,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      summary: { totalSales: 90000, ordersCount: 1, averageTicket: 90000 },
    });
  });

  it('sin ventas responde 200 con lista vacia y resumen en ceros', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.summary).toEqual({ totalSales: 0, ordersCount: 0, averageTicket: 0 });
  });

  it('pasa filtros y paginacion al repositorio', async () => {
    await get(
      `?from=2026-11-01&to=2026-11-14&waiterId=${WAITER}&tableId=${TABLE}&paymentMethodId=${METHOD}&page=2&pageSize=50`,
    );
    expect(findHistoryPage).toHaveBeenCalledWith({
      start: new Date('2026-11-01T05:00:00Z'),
      end: new Date('2026-11-15T05:00:00Z'),
      waiterId: WAITER,
      tableId: TABLE,
      paymentMethodId: METHOD,
      skip: 50,
      take: 50,
    });
  });

  it('no la captura GET /api/orders/:orderId (que responderia 400 por UUID invalido)', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('summary');
  });

  it('un error de la base -> 500 sin filtrar el detalle', async () => {
    aggregateHistory.mockRejectedValue(new Error('connection refused'));
    const res = await get();
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('connection refused');
  });
});

describe('validacion (400 VALIDATION_ERROR)', () => {
  it.each([
    ['solo from', '?from=2026-11-14'],
    ['from posterior a to', '?from=2026-11-15&to=2026-11-14'],
    ['mas de 366 dias', '?from=2026-01-01&to=2027-01-02'],
    ['fecha inexistente', '?from=2026-02-30&to=2026-03-01'],
    ['waiterId no UUID', '?waiterId=mesero1'],
    ['pageSize mayor a 100', '?pageSize=101'],
    ['page 0', '?page=0'],
    ['parametro desconocido', '?status=CERRADA'],
  ])('%s', async (_label, query) => {
    const res = await get(query);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(findHistoryPage).not.toHaveBeenCalled();
  });
});
