import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../repositories/round.repository.js');
vi.mock('../realtime/events.js');
vi.mock('../clients/catalogClient.js');
vi.mock('./tableStatus.service.js');

const repo = await import('../repositories/round.repository.js');
const events = await import('../realtime/events.js');
const { catalogClient } = await import('../clients/catalogClient.js');
const { createRound } = await import('./round.service.js');

const ORDER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const USER_ID = '11111111-2222-3333-4444-555555555555';
const OTHER_USER = '22222222-3333-4444-5555-666666666666';
const PRODUCT_A = '00000000-0000-4000-a000-000000000001';
const PRODUCT_B = '00000000-0000-4000-a000-000000000002';
const PRODUCT_UNAVAIL = '00000000-0000-4000-a000-000000000005';

const waiterUser = { userId: USER_ID, role: 'WAITER' };
const adminUser = { userId: OTHER_USER, role: 'ADMIN' };
const otherWaiter = { userId: OTHER_USER, role: 'WAITER' };

function makeOrder(overrides = {}) {
  return {
    orderId: ORDER_ID,
    tableId: 'table-1',
    waiterId: USER_ID,
    status: 'ABIERTA',
    openedAt: new Date(),
    table: { tableNumber: 5 },
    ...overrides,
  };
}

function makeItems(ids = [PRODUCT_A]) {
  return ids.map((productId) => ({ productId, quantity: 2, note: 'sin sal' }));
}

function makeCatalogProducts(entries) {
  return entries.map(([id, name, price, avail]) => ({
    productId: id,
    name,
    price,
    isAvailable: avail,
  }));
}

function makeRoundResult(items) {
  const now = new Date();
  return {
    roundId: 'round-1',
    orderId: ORDER_ID,
    source: 'WAITER',
    createdBy: USER_ID,
    createdAt: now,
    items: items.map((item, i) => ({
      itemId: `item-${i}`,
      roundId: 'round-1',
      productId: item.productId,
      productNameSnapshot: item.productName,
      unitPriceSnapshot: item.unitPrice,
      quantity: item.quantity,
      note: item.note || null,
      status: 'pendiente',
      preparationStartedAt: null,
      readyAt: null,
      deliveredAt: null,
      cancelledAt: null,
      cancelledReason: null,
      cancelledBy: null,
      createdAt: now,
      updatedAt: now,
    })),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  events.emitRoundCreated.mockImplementation(() => {});
});

describe('createRound', () => {
  it('throws 404 when order does not exist', async () => {
    repo.findOrderById.mockResolvedValue(null);

    await expect(createRound(ORDER_ID, makeItems(), waiterUser)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('throws 409 when order is not ABIERTA', async () => {
    repo.findOrderById.mockResolvedValue(makeOrder({ status: 'CERRADA' }));

    await expect(createRound(ORDER_ID, makeItems(), waiterUser)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
    });
  });

  it('throws 403 when waiter is not assigned to the order', async () => {
    repo.findOrderById.mockResolvedValue(makeOrder());

    await expect(createRound(ORDER_ID, makeItems(), otherWaiter)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
  });

  it('allows ADMIN to create round on any order', async () => {
    const order = makeOrder();
    repo.findOrderById.mockResolvedValue(order);
    catalogClient.getProductsByIds.mockResolvedValue(
      makeCatalogProducts([[PRODUCT_A, 'Pizza Margarita', 28000, true]]),
    );
    const roundResult = makeRoundResult([
      { productId: PRODUCT_A, productName: 'Pizza Margarita', unitPrice: 28000, quantity: 2, note: 'sin sal' },
    ]);
    repo.createRoundWithItems.mockResolvedValue(roundResult);

    const result = await createRound(ORDER_ID, makeItems(), adminUser);

    expect(result.round.roundId).toBe('round-1');
  });

  it('creates round with available items and returns unavailable', async () => {
    const order = makeOrder();
    repo.findOrderById.mockResolvedValue(order);
    catalogClient.getProductsByIds.mockResolvedValue(
      makeCatalogProducts([
        [PRODUCT_A, 'Pizza Margarita', 28000, true],
        [PRODUCT_UNAVAIL, 'Tiramisú', 15000, false],
      ]),
    );
    const roundResult = makeRoundResult([
      { productId: PRODUCT_A, productName: 'Pizza Margarita', unitPrice: 28000, quantity: 2, note: 'sin sal' },
    ]);
    repo.createRoundWithItems.mockResolvedValue(roundResult);

    const result = await createRound(
      ORDER_ID,
      makeItems([PRODUCT_A, PRODUCT_UNAVAIL]),
      waiterUser,
    );

    expect(result.round.items).toHaveLength(1);
    expect(result.unavailable).toEqual([
      { productId: PRODUCT_UNAVAIL, name: 'Tiramisú' },
    ]);
  });

  it('throws 409 when ALL items are unavailable', async () => {
    repo.findOrderById.mockResolvedValue(makeOrder());
    catalogClient.getProductsByIds.mockResolvedValue(
      makeCatalogProducts([[PRODUCT_UNAVAIL, 'Tiramisú', 15000, false]]),
    );

    await expect(
      createRound(ORDER_ID, makeItems([PRODUCT_UNAVAIL]), waiterUser),
    ).rejects.toMatchObject({
      status: 409,
      code: 'NO_AVAILABLE_ITEMS',
    });
  });

  it('throws 409 when product not found in catalog', async () => {
    repo.findOrderById.mockResolvedValue(makeOrder());
    catalogClient.getProductsByIds.mockResolvedValue([]);

    await expect(
      createRound(ORDER_ID, makeItems([PRODUCT_A]), waiterUser),
    ).rejects.toMatchObject({
      status: 409,
      code: 'NO_AVAILABLE_ITEMS',
    });
  });

  it('emits round:created to kitchen with correct payload', async () => {
    const order = makeOrder();
    repo.findOrderById.mockResolvedValue(order);
    catalogClient.getProductsByIds.mockResolvedValue(
      makeCatalogProducts([[PRODUCT_A, 'Pizza Margarita', 28000, true]]),
    );
    const roundResult = makeRoundResult([
      { productId: PRODUCT_A, productName: 'Pizza Margarita', unitPrice: 28000, quantity: 2, note: 'sin sal' },
    ]);
    repo.createRoundWithItems.mockResolvedValue(roundResult);

    await createRound(ORDER_ID, makeItems(), waiterUser);

    expect(events.emitRoundCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        roundId: 'round-1',
        orderId: ORDER_ID,
        tableNumber: 5,
        items: expect.arrayContaining([
          expect.objectContaining({ productName: 'Pizza Margarita' }),
        ]),
      }),
    );
  });

  it('does not emit event when order not found', async () => {
    repo.findOrderById.mockResolvedValue(null);

    await expect(createRound(ORDER_ID, makeItems(), waiterUser)).rejects.toThrow();
    expect(events.emitRoundCreated).not.toHaveBeenCalled();
  });

  it('passes snapshot data (name+price) from catalog to repository', async () => {
    const order = makeOrder();
    repo.findOrderById.mockResolvedValue(order);
    catalogClient.getProductsByIds.mockResolvedValue(
      makeCatalogProducts([[PRODUCT_A, 'Pizza Margarita', 28000, true]]),
    );
    repo.createRoundWithItems.mockResolvedValue(
      makeRoundResult([
        { productId: PRODUCT_A, productName: 'Pizza Margarita', unitPrice: 28000, quantity: 2, note: 'sin sal' },
      ]),
    );

    await createRound(ORDER_ID, makeItems(), waiterUser);

    expect(repo.createRoundWithItems).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: ORDER_ID,
        source: 'WAITER',
        createdBy: USER_ID,
        items: [
          expect.objectContaining({
            productName: 'Pizza Margarita',
            unitPrice: 28000,
          }),
        ],
      }),
    );
  });

  it('deduplicates product IDs when querying catalog', async () => {
    const order = makeOrder();
    repo.findOrderById.mockResolvedValue(order);
    catalogClient.getProductsByIds.mockResolvedValue(
      makeCatalogProducts([[PRODUCT_A, 'Pizza Margarita', 28000, true]]),
    );
    repo.createRoundWithItems.mockResolvedValue(
      makeRoundResult([
        { productId: PRODUCT_A, productName: 'Pizza Margarita', unitPrice: 28000, quantity: 2 },
        { productId: PRODUCT_A, productName: 'Pizza Margarita', unitPrice: 28000, quantity: 1 },
      ]),
    );

    const items = [
      { productId: PRODUCT_A, quantity: 2 },
      { productId: PRODUCT_A, quantity: 1 },
    ];
    await createRound(ORDER_ID, items, waiterUser);

    expect(catalogClient.getProductsByIds).toHaveBeenCalledWith([PRODUCT_A]);
  });

  it('maps Prisma field names to contract JSON names in response', async () => {
    const order = makeOrder();
    repo.findOrderById.mockResolvedValue(order);
    catalogClient.getProductsByIds.mockResolvedValue(
      makeCatalogProducts([[PRODUCT_A, 'Pizza Margarita', 28000, true]]),
    );
    repo.createRoundWithItems.mockResolvedValue(
      makeRoundResult([
        { productId: PRODUCT_A, productName: 'Pizza Margarita', unitPrice: 28000, quantity: 2, note: 'sin sal' },
      ]),
    );

    const result = await createRound(ORDER_ID, makeItems(), waiterUser);

    expect(result.round.items[0]).toHaveProperty('productName', 'Pizza Margarita');
    expect(result.round.items[0]).toHaveProperty('unitPrice', 28000);
    expect(result.round.items[0]).not.toHaveProperty('productNameSnapshot');
    expect(result.round.items[0]).not.toHaveProperty('unitPriceSnapshot');
  });

  it('does not include unavailable array when all items are available', async () => {
    const order = makeOrder();
    repo.findOrderById.mockResolvedValue(order);
    catalogClient.getProductsByIds.mockResolvedValue(
      makeCatalogProducts([[PRODUCT_A, 'Pizza Margarita', 28000, true]]),
    );
    repo.createRoundWithItems.mockResolvedValue(
      makeRoundResult([
        { productId: PRODUCT_A, productName: 'Pizza Margarita', unitPrice: 28000, quantity: 2, note: 'sin sal' },
      ]),
    );

    const result = await createRound(ORDER_ID, makeItems(), waiterUser);

    expect(result).not.toHaveProperty('unavailable');
  });

  it('creates round with multiple distinct available items', async () => {
    const order = makeOrder();
    repo.findOrderById.mockResolvedValue(order);
    catalogClient.getProductsByIds.mockResolvedValue(
      makeCatalogProducts([
        [PRODUCT_A, 'Pizza Margarita', 28000, true],
        [PRODUCT_B, 'Pizza Pepperoni', 32000, true],
      ]),
    );
    repo.createRoundWithItems.mockResolvedValue(
      makeRoundResult([
        { productId: PRODUCT_A, productName: 'Pizza Margarita', unitPrice: 28000, quantity: 1 },
        { productId: PRODUCT_B, productName: 'Pizza Pepperoni', unitPrice: 32000, quantity: 3 },
      ]),
    );

    const items = [
      { productId: PRODUCT_A, quantity: 1 },
      { productId: PRODUCT_B, quantity: 3 },
    ];
    const result = await createRound(ORDER_ID, items, waiterUser);

    expect(result.round.items).toHaveLength(2);
    expect(repo.createRoundWithItems).toHaveBeenCalledWith(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ productName: 'Pizza Margarita', quantity: 1 }),
          expect.objectContaining({ productName: 'Pizza Pepperoni', quantity: 3 }),
        ]),
      }),
    );
  });

  it('throws 409 for EN_COBRO order status', async () => {
    repo.findOrderById.mockResolvedValue(makeOrder({ status: 'EN_COBRO' }));

    await expect(createRound(ORDER_ID, makeItems(), waiterUser)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
    });
  });
});

// GC-ORD-0005 Esc. 2: el cliente pide mas con la mesa ocupada y la ronda cae en la misma orden.
describe('nueva ronda en la misma orden', () => {
  it('dos rondas usan el mismo orderId, no abren otra orden y cada una guarda su propio snapshot', async () => {
    repo.findOrderById.mockResolvedValue(makeOrder());
    repo.createRoundWithItems.mockImplementation(async ({ items }) => makeRoundResult(items));
    // Entre la primera y la segunda ronda Catalog sube el precio
    catalogClient.getProductsByIds
      .mockResolvedValueOnce(makeCatalogProducts([[PRODUCT_A, 'Pizza Margarita', 28000, true]]))
      .mockResolvedValueOnce(makeCatalogProducts([[PRODUCT_A, 'Pizza Margarita', 31000, true]]));

    const first = await createRound(ORDER_ID, makeItems(), waiterUser);
    const second = await createRound(ORDER_ID, makeItems(), waiterUser);

    expect(repo.createRoundWithItems).toHaveBeenCalledTimes(2);
    for (const [args] of repo.createRoundWithItems.mock.calls) {
      expect(args.orderId).toBe(ORDER_ID);
    }
    // Que no exista una segunda orden en la base (indice uix_orders_one_open_per_table) lo prueba el E2E
    expect(first.round.orderId).toBe(ORDER_ID);
    expect(second.round.orderId).toBe(ORDER_ID);
    expect(first.round.items[0].unitPrice).toBe(28000);
    expect(second.round.items[0].unitPrice).toBe(31000);
  });
});
