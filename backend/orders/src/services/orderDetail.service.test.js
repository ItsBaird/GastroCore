import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../repositories/round.repository.js');

const repo = await import('../repositories/round.repository.js');
const { getOrderDetail } = await import('./orderDetail.service.js');

const ORDER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const USER_ID = '11111111-2222-3333-4444-555555555555';
const OTHER_USER = '22222222-3333-4444-5555-666666666666';

const waiterUser = { userId: USER_ID, role: 'WAITER' };
const adminUser = { userId: OTHER_USER, role: 'ADMIN' };
const otherWaiter = { userId: OTHER_USER, role: 'WAITER' };

function makeOrderWithRounds(overrides = {}) {
  const now = new Date();
  return {
    orderId: ORDER_ID,
    tableId: 'table-1',
    waiterId: USER_ID,
    status: 'ABIERTA',
    openedAt: now,
    closedAt: null,
    discountAmount: 0,
    table: { tableNumber: 5 },
    rounds: [
      {
        roundId: 'round-1',
        orderId: ORDER_ID,
        source: 'WAITER',
        createdBy: USER_ID,
        createdAt: now,
        items: [
          {
            itemId: 'item-1',
            roundId: 'round-1',
            productId: 'prod-1',
            productNameSnapshot: 'Pizza Margarita',
            unitPriceSnapshot: 28000,
            quantity: 2,
            note: null,
            status: 'pendiente',
            preparationStartedAt: null,
            readyAt: null,
            deliveredAt: null,
            cancelledAt: null,
            cancelledReason: null,
            cancelledBy: null,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('getOrderDetail', () => {
  it('throws 404 when order does not exist', async () => {
    repo.findOrderWithRoundsAndItems.mockResolvedValue(null);

    await expect(getOrderDetail(ORDER_ID, waiterUser)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('throws 403 when waiter is not assigned', async () => {
    repo.findOrderWithRoundsAndItems.mockResolvedValue(makeOrderWithRounds());

    await expect(getOrderDetail(ORDER_ID, otherWaiter)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
  });

  it('allows ADMIN to view any order', async () => {
    repo.findOrderWithRoundsAndItems.mockResolvedValue(makeOrderWithRounds());

    const result = await getOrderDetail(ORDER_ID, adminUser);

    expect(result.orderId).toBe(ORDER_ID);
  });

  it('returns order with mapped round and item fields', async () => {
    repo.findOrderWithRoundsAndItems.mockResolvedValue(makeOrderWithRounds());

    const result = await getOrderDetail(ORDER_ID, waiterUser);

    expect(result.tableNumber).toBe(5);
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0].items[0]).toHaveProperty('productName', 'Pizza Margarita');
    expect(result.rounds[0].items[0]).toHaveProperty('unitPrice', 28000);
    expect(result.rounds[0].items[0]).not.toHaveProperty('productNameSnapshot');
  });

  it('includes openedAt for timer calculation', async () => {
    repo.findOrderWithRoundsAndItems.mockResolvedValue(makeOrderWithRounds());

    const result = await getOrderDetail(ORDER_ID, waiterUser);

    expect(result).toHaveProperty('openedAt');
    expect(result.openedAt).toBeInstanceOf(Date);
  });
});
