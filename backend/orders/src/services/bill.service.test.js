import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../repositories/bill.repository.js', () => ({
  findOrderForBill: vi.fn(),
}));

const repo = await import('../repositories/bill.repository.js');
const { getBill } = await import('./bill.service.js');

const WAITER = { userId: 'waiter-1', role: 'WAITER' };
const OTHER = { userId: 'waiter-2', role: 'WAITER' };
const ADMIN = { userId: 'admin-1', role: 'ADMIN' };

function row(itemId, status, unitPriceSnapshot, quantity) {
  return {
    itemId,
    roundId: 'r1',
    productId: `p-${itemId}`,
    productNameSnapshot: `Prod ${itemId}`,
    unitPriceSnapshot,
    quantity,
    status,
  };
}

function makeOrder({ status = 'ABIERTA', waiterId = 'waiter-1', discountAmount = 0, items } = {}) {
  return {
    orderId: 'order-1',
    tableId: 'table-1',
    waiterId,
    status,
    discountAmount,
    table: { tableId: 'table-1', tableNumber: 7 },
    rounds: [
      {
        items: items ?? [
          row('a', 'entregado', 35000, 2),
          row('b', 'listo', 45000, 1),
          row('c', 'cancelado', 9000, 1),
        ],
      },
    ],
  };
}

beforeEach(() => vi.resetAllMocks());

describe('getBill', () => {
  it('devuelve la cuenta calculada en el backend con mesa y estado', async () => {
    repo.findOrderForBill.mockResolvedValue(makeOrder());

    const bill = await getBill('order-1', WAITER);

    expect(bill).toMatchObject({
      orderId: 'order-1',
      tableNumber: 7,
      subtotal: 115000,
      discountAmount: 0,
      total: 115000,
    });
    expect(bill.items.map((i) => i.itemId)).toEqual(['a', 'b']);
  });

  it('el ADMIN pide la cuenta de cualquier mesa', async () => {
    repo.findOrderForBill.mockResolvedValue(makeOrder());

    await expect(getBill('order-1', ADMIN)).resolves.toMatchObject({ total: 115000 });
  });

  it('otro mesero recibe 403', async () => {
    repo.findOrderForBill.mockResolvedValue(makeOrder());

    await expect(getBill('order-1', OTHER)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
  });

  it('orden inexistente responde 404', async () => {
    repo.findOrderForBill.mockResolvedValue(null);

    await expect(getBill('order-1', WAITER)).rejects.toMatchObject({ status: 404 });
  });

  it('orden CERRADA responde 409', async () => {
    repo.findOrderForBill.mockResolvedValue(makeOrder({ status: 'CERRADA' }));

    await expect(getBill('order-1', WAITER)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
    });
  });

  it('un descuento mayor que el subtotal no produce un total negativo: 409', async () => {
    repo.findOrderForBill.mockResolvedValue(
      makeOrder({ status: 'EN_COBRO', discountAmount: 999999 }),
    );

    await expect(getBill('order-1', WAITER)).rejects.toMatchObject({ status: 409 });
  });
});
