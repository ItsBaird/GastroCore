// GET /api/orders/history/:orderId (GC-RPT-0003, GC-189) con la app real: roles, 400 por id invalido, 404 si la
// cuenta no existe o no esta cerrada, y la forma HistoryOrderDetail. Solo el repositorio va simulado.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { findHistoryOrder } from '../repositories/history.repository.js';
import { call, startApp, tokenFor } from '../test/helpers.js';

vi.mock('../config/prisma.js', () => ({ prisma: {} }));
vi.mock('../repositories/history.repository.js', () => ({
  findHistoryPage: vi.fn(),
  findHistoryOrder: vi.fn(),
  findHistoryForExport: vi.fn(),
  aggregateHistory: vi.fn(),
}));

const ORDER = '3f9a1c7e-0b2d-4e5f-8a9b-1c2d3e4f5a6b';
const TABLE = '22222222-2222-4222-8222-222222222222';
const WAITER = '33333333-3333-4333-8333-333333333333';
const CASH = '44444444-4444-4444-8444-444444444444';
const PIZZA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LIMO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const URL = `/api/orders/history/${ORDER}`;

const stored = {
  orderId: ORDER,
  tableId: TABLE,
  openedBy: WAITER,
  openedAt: new Date('2026-11-14T17:00:00Z'),
  closedAt: new Date('2026-11-14T19:00:00Z'),
  table: { tableNumber: 7 },
  payment: {
    subtotal: 64000,
    discountAmount: 4000,
    total: 60000,
    paymentMethodId: CASH,
    amountReceived: 70000,
    changeGiven: 10000,
  },
  rounds: [
    {
      items: [
        {
          productId: PIZZA,
          productNameSnapshot: 'Pizza Margarita',
          unitPriceSnapshot: 28000,
          quantity: 2,
        },
      ],
    },
    {
      items: [
        { productId: LIMO, productNameSnapshot: 'Limonada', unitPriceSnapshot: 8000, quantity: 1 },
      ],
    },
  ],
};

let app;
// Sin token: pasar null (un undefined activaria el valor por defecto, un token de ADMIN)
const get = (url = URL, token = tokenFor('ADMIN')) => call(app.base, 'GET', url, { token });

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  findHistoryOrder.mockResolvedValue(stored);
});

describe('acceso: solo el ADMIN', () => {
  it('sin sesion -> 401', async () => {
    expect((await get(URL, null)).status).toBe(401);
    expect(findHistoryOrder).not.toHaveBeenCalled();
  });

  it.each(['WAITER', 'COOK'])('un %s -> 403 y no consulta nada', async (role) => {
    const res = await get(URL, tokenFor(role));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(findHistoryOrder).not.toHaveBeenCalled();
  });
});

describe('GET /api/orders/history/:orderId', () => {
  it('responde HistoryOrderDetail: la fila del historial, las lineas, recibido y cambio', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      orderId: ORDER,
      reference: '3F9A1C',
      tableId: TABLE,
      tableNumber: 7,
      waiterId: WAITER,
      openedAt: '2026-11-14T17:00:00.000Z',
      closedAt: '2026-11-14T19:00:00.000Z',
      itemsCount: 3,
      subtotal: 64000,
      discountAmount: 4000,
      total: 60000,
      paymentMethodId: CASH,
      lines: [
        {
          productId: PIZZA,
          productName: 'Pizza Margarita',
          quantity: 2,
          unitPrice: 28000,
          lineTotal: 56000,
        },
        { productId: LIMO, productName: 'Limonada', quantity: 1, unitPrice: 8000, lineTotal: 8000 },
      ],
      cashReceived: 70000,
      changeGiven: 10000,
    });
    expect(findHistoryOrder).toHaveBeenCalledWith(ORDER);
  });

  it('hecho cuando: las lineas suman el subtotal y total = subtotal - descuento', async () => {
    const { body } = await get();
    expect(body.lines.reduce((s, l) => s + l.lineTotal, 0)).toBe(body.subtotal);
    expect(body.total).toBe(body.subtotal - body.discountAmount);
  });

  it('pago que no es en efectivo: cashReceived y changeGiven en null', async () => {
    findHistoryOrder.mockResolvedValue({
      ...stored,
      payment: { ...stored.payment, amountReceived: null, changeGiven: null },
    });
    const { body } = await get();
    expect(body.cashReceived).toBeNull();
    expect(body.changeGiven).toBeNull();
  });

  it('cuenta inexistente o no cerrada -> 404 ORDER_NOT_FOUND', async () => {
    findHistoryOrder.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
  });

  it.each(['no-es-uuid', '123', '3f9a1c7e'])(
    'id invalido "%s" -> 400 y no consulta',
    async (id) => {
      const res = await get(`/api/orders/history/${id}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(findHistoryOrder).not.toHaveBeenCalled();
    },
  );

  it('el listado sigue respondiendo en /history (la ruta del detalle no lo captura)', async () => {
    const repo = await import('../repositories/history.repository.js');
    repo.findHistoryPage.mockResolvedValue([]);
    repo.aggregateHistory.mockResolvedValue({ totalSales: 0, ordersCount: 0 });
    const res = await get('/api/orders/history', tokenFor('ADMIN'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('summary');
    expect(findHistoryOrder).not.toHaveBeenCalled();
  });

  it('un error de la base -> 500 sin filtrar el detalle', async () => {
    findHistoryOrder.mockRejectedValue(new Error('connection refused'));
    const res = await get();
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('connection refused');
  });
});
