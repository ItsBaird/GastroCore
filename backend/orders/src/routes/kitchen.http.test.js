// GET /api/orders/kitchen con la app real: roles, y que no lo capture GET /:orderId.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { findKitchenRounds } from '../repositories/kitchen.repository.js';
import { call, startApp, tokenFor } from '../test/helpers.js';

vi.mock('../config/prisma.js', () => ({ prisma: {} }));
vi.mock('../repositories/kitchen.repository.js', () => ({ findKitchenRounds: vi.fn() }));

const URL = '/api/orders/kitchen';
const CREATED_AT = '2026-11-07T15:00:00.000Z';

const dbRound = {
  roundId: 'r1',
  orderId: 'o1',
  source: 'WAITER',
  createdBy: 'u1',
  createdAt: new Date(CREATED_AT),
  order: { table: { tableNumber: 7 } },
  items: [
    {
      itemId: 'i1',
      roundId: 'r1',
      productId: 'p1',
      productNameSnapshot: 'Pizza Hawaiana',
      unitPriceSnapshot: 32000,
      quantity: 2,
      note: 'Sin piña',
      status: 'pendiente',
      preparationStartedAt: null,
      readyAt: null,
      deliveredAt: null,
      cancelledReason: null,
      cancelledBy: null,
      createdAt: new Date(CREATED_AT),
      updatedAt: new Date(CREATED_AT),
    },
  ],
};

let app;

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  findKitchenRounds.mockResolvedValue([dbRound]);
});

describe('GET /api/orders/kitchen', () => {
  it.each(['COOK', 'ADMIN'])('%s recibe las rondas con el formato del contrato', async (role) => {
    const res = await call(app.base, 'GET', URL, { token: tokenFor(role) });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        roundId: 'r1',
        orderId: 'o1',
        tableNumber: 7,
        source: 'WAITER',
        createdAt: CREATED_AT,
        items: [
          expect.objectContaining({
            itemId: 'i1',
            productName: 'Pizza Hawaiana',
            quantity: 2,
            note: 'Sin piña',
            status: 'pendiente',
          }),
        ],
      },
    ]);
  });

  it('sin rondas responde una lista vacia', async () => {
    findKitchenRounds.mockResolvedValue([]);

    const res = await call(app.base, 'GET', URL, { token: tokenFor('COOK') });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('sin token responde 401', async () => {
    const res = await call(app.base, 'GET', URL);

    expect(res.status).toBe(401);
    expect(findKitchenRounds).not.toHaveBeenCalled();
  });

  it('WAITER responde 403', async () => {
    const res = await call(app.base, 'GET', URL, { token: tokenFor('WAITER') });

    expect(res.status).toBe(403);
    expect(findKitchenRounds).not.toHaveBeenCalled();
  });
});
