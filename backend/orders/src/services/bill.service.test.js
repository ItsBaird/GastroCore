import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../repositories/bill.repository.js', () => ({
  findOrderForBill: vi.fn(),
  moveOrderToBilling: vi.fn(),
}));
vi.mock('../realtime/events.js', () => ({ emitTableStatusChanged: vi.fn() }));
vi.mock('./tableStatus.service.js', () => ({ getTableStatus: vi.fn() }));

const repo = await import('../repositories/bill.repository.js');
const events = await import('../realtime/events.js');
const { getTableStatus } = await import('./tableStatus.service.js');
const { getBill } = await import('./bill.service.js');

const WAITER = { userId: 'waiter-1', role: 'WAITER' };
const OTHER = { userId: 'waiter-2', role: 'WAITER' };
const ADMIN = { userId: 'admin-1', role: 'ADMIN' };
const TABLE_STATUS = { tableId: 'table-1', tableNumber: 7, status: 'en_cobro', pendingCalls: [] };

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

const DEFAULT_ITEMS = [
  row('a', 'entregado', 35000, 2),
  row('b', 'listo', 45000, 1),
  row('c', 'cancelado', 9000, 1),
];

function makeOrder({ status = 'ABIERTA', waiterId = 'waiter-1', discountAmount = 0, items } = {}) {
  return {
    orderId: 'order-1',
    tableId: 'table-1',
    waiterId,
    status,
    discountAmount,
    table: { tableId: 'table-1', tableNumber: 7 },
    rounds: [{ items: items ?? DEFAULT_ITEMS }],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  getTableStatus.mockResolvedValue(TABLE_STATUS);
});

describe('getBill: calculo y permisos', () => {
  it('devuelve la cuenta calculada en el backend, con mesa y estado', async () => {
    repo.findOrderForBill
      .mockResolvedValueOnce(makeOrder())
      .mockResolvedValueOnce(makeOrder({ status: 'EN_COBRO' }));
    repo.moveOrderToBilling.mockResolvedValue(true);

    const bill = await getBill('order-1', WAITER);

    expect(bill).toMatchObject({
      orderId: 'order-1',
      tableNumber: 7,
      status: 'EN_COBRO',
      subtotal: 115000,
      discountAmount: 0,
      total: 115000,
    });
    expect(bill.items.map((i) => i.itemId)).toEqual(['a', 'b']);
  });

  it('el ADMIN pide la cuenta de cualquier mesa', async () => {
    repo.findOrderForBill.mockResolvedValue(makeOrder({ status: 'EN_COBRO' }));

    await expect(getBill('order-1', ADMIN)).resolves.toMatchObject({ total: 115000 });
  });

  it('otro mesero recibe 403 y no se cambia nada', async () => {
    repo.findOrderForBill.mockResolvedValue(makeOrder());

    await expect(getBill('order-1', OTHER)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(repo.moveOrderToBilling).not.toHaveBeenCalled();
  });

  it('orden inexistente responde 404', async () => {
    repo.findOrderForBill.mockResolvedValue(null);

    await expect(getBill('order-1', WAITER)).rejects.toMatchObject({ status: 404 });
  });

  it('orden CERRADA responde 409 INVALID_TRANSITION', async () => {
    repo.findOrderForBill.mockResolvedValue(makeOrder({ status: 'CERRADA' }));

    await expect(getBill('order-1', WAITER)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
    });
    expect(repo.moveOrderToBilling).not.toHaveBeenCalled();
  });

  it('un descuento mayor que el subtotal: 409 y la mesa no pasa a cobro', async () => {
    repo.findOrderForBill.mockResolvedValue(makeOrder({ discountAmount: 999999 }));

    await expect(getBill('order-1', WAITER)).rejects.toMatchObject({ status: 409 });
    expect(repo.moveOrderToBilling).not.toHaveBeenCalled();
  });
});

describe('getBill: transicion a en_cobro', () => {
  it('con la mesa ocupada y un item entregado pasa a EN_COBRO y emite tras escribir', async () => {
    repo.findOrderForBill
      .mockResolvedValueOnce(makeOrder())
      .mockResolvedValueOnce(makeOrder({ status: 'EN_COBRO' }));
    repo.moveOrderToBilling.mockImplementation(async () => {
      expect(events.emitTableStatusChanged).not.toHaveBeenCalled();
      return true;
    });

    await getBill('order-1', WAITER);

    expect(repo.moveOrderToBilling).toHaveBeenCalledWith('order-1');
    expect(getTableStatus).toHaveBeenCalledWith('table-1');
    expect(events.emitTableStatusChanged).toHaveBeenCalledOnce();
    expect(events.emitTableStatusChanged).toHaveBeenCalledWith(TABLE_STATUS);
  });

  it('sin items entregados responde 409 NO_DELIVERED_ITEMS sin cambiar nada', async () => {
    repo.findOrderForBill.mockResolvedValue(
      makeOrder({ items: [row('a', 'listo', 1000, 1), row('b', 'pendiente', 1000, 1)] }),
    );

    await expect(getBill('order-1', WAITER)).rejects.toMatchObject({
      status: 409,
      code: 'NO_DELIVERED_ITEMS',
    });
    expect(repo.moveOrderToBilling).not.toHaveBeenCalled();
    expect(events.emitTableStatusChanged).not.toHaveBeenCalled();
  });

  it('un item entregado y el resto sin entregar: se genera (criterio literal)', async () => {
    repo.findOrderForBill
      .mockResolvedValueOnce(makeOrder())
      .mockResolvedValueOnce(makeOrder({ status: 'EN_COBRO' }));
    repo.moveOrderToBilling.mockResolvedValue(true);

    const bill = await getBill('order-1', WAITER);

    expect(bill.items.map((i) => i.status)).toEqual(['entregado', 'listo']);
  });

  it('idempotente: con la orden ya EN_COBRO devuelve la cuenta sin transicion ni evento', async () => {
    repo.findOrderForBill.mockResolvedValue(makeOrder({ status: 'EN_COBRO' }));

    const first = await getBill('order-1', WAITER);
    const second = await getBill('order-1', WAITER);

    expect(second).toEqual(first);
    expect(repo.moveOrderToBilling).not.toHaveBeenCalled();
    expect(events.emitTableStatusChanged).not.toHaveBeenCalled();
  });

  it('dos solicitudes a la vez: la que pierde no emite y tambien recibe la cuenta', async () => {
    repo.findOrderForBill
      .mockResolvedValueOnce(makeOrder())
      .mockResolvedValueOnce(makeOrder({ status: 'EN_COBRO' }));
    repo.moveOrderToBilling.mockResolvedValue(false);

    await expect(getBill('order-1', WAITER)).resolves.toMatchObject({
      status: 'EN_COBRO',
      total: 115000,
    });
    expect(events.emitTableStatusChanged).not.toHaveBeenCalled();
  });

  it('si la orden se cerro mientras tanto responde 409', async () => {
    repo.findOrderForBill
      .mockResolvedValueOnce(makeOrder())
      .mockResolvedValueOnce(makeOrder({ status: 'CERRADA' }));
    repo.moveOrderToBilling.mockResolvedValue(false);

    await expect(getBill('order-1', WAITER)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });
});
