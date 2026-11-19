import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../repositories/bill.repository.js', () => ({
  findOrderForBill: vi.fn(),
  moveOrderToBilling: vi.fn(),
  moveOrderBackToOpen: vi.fn(),
}));
vi.mock('../realtime/events.js', () => ({ emitTableStatusChanged: vi.fn() }));
vi.mock('./tableStatus.service.js', () => ({ getTableStatus: vi.fn() }));

const repo = await import('../repositories/bill.repository.js');
const events = await import('../realtime/events.js');
const { getTableStatus } = await import('./tableStatus.service.js');
const { cancelBill, getBill, startBilling } = await import('./bill.service.js');

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

describe('getBill: solo lectura', () => {
  it('devuelve la cuenta calculada en el backend, con mesa y estado', async () => {
    repo.findOrderForBill.mockResolvedValue(makeOrder({ status: 'EN_COBRO' }));

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

  it('con la orden ABIERTA devuelve la cuenta sin pasarla a cobro ni emitir', async () => {
    repo.findOrderForBill.mockResolvedValue(makeOrder());

    await expect(getBill('order-1', WAITER)).resolves.toMatchObject({
      status: 'ABIERTA',
      total: 115000,
    });
    expect(repo.moveOrderToBilling).not.toHaveBeenCalled();
    expect(events.emitTableStatusChanged).not.toHaveBeenCalled();
  });

  it('sin items entregados tambien se puede ver (la regla es de solicitar el cobro)', async () => {
    repo.findOrderForBill.mockResolvedValue(makeOrder({ items: [row('a', 'pendiente', 1000, 1)] }));

    await expect(getBill('order-1', WAITER)).resolves.toMatchObject({ total: 1000 });
    expect(repo.moveOrderToBilling).not.toHaveBeenCalled();
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

describe('startBilling: transicion a en_cobro', () => {
  it('con la mesa ocupada y un item entregado pasa a EN_COBRO y emite tras escribir', async () => {
    repo.findOrderForBill
      .mockResolvedValueOnce(makeOrder())
      .mockResolvedValueOnce(makeOrder({ status: 'EN_COBRO' }));
    repo.moveOrderToBilling.mockImplementation(async () => {
      expect(events.emitTableStatusChanged).not.toHaveBeenCalled();
      return true;
    });

    await startBilling('order-1', WAITER);

    expect(repo.moveOrderToBilling).toHaveBeenCalledWith('order-1');
    expect(getTableStatus).toHaveBeenCalledWith('table-1');
    expect(events.emitTableStatusChanged).toHaveBeenCalledOnce();
    expect(events.emitTableStatusChanged).toHaveBeenCalledWith(TABLE_STATUS);
  });

  it('sin items entregados responde 409 NO_DELIVERED_ITEMS sin cambiar nada', async () => {
    repo.findOrderForBill.mockResolvedValue(
      makeOrder({ items: [row('a', 'listo', 1000, 1), row('b', 'pendiente', 1000, 1)] }),
    );

    await expect(startBilling('order-1', WAITER)).rejects.toMatchObject({
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

    const bill = await startBilling('order-1', WAITER);

    expect(bill.items.map((i) => i.status)).toEqual(['entregado', 'listo']);
  });

  it('idempotente: con la orden ya EN_COBRO devuelve la cuenta sin transicion ni evento', async () => {
    repo.findOrderForBill.mockResolvedValue(makeOrder({ status: 'EN_COBRO' }));

    const first = await startBilling('order-1', WAITER);
    const second = await startBilling('order-1', WAITER);

    expect(second).toEqual(first);
    expect(repo.moveOrderToBilling).not.toHaveBeenCalled();
    expect(events.emitTableStatusChanged).not.toHaveBeenCalled();
  });

  it('dos solicitudes a la vez: la que pierde no emite y tambien recibe la cuenta', async () => {
    repo.findOrderForBill
      .mockResolvedValueOnce(makeOrder())
      .mockResolvedValueOnce(makeOrder({ status: 'EN_COBRO' }));
    repo.moveOrderToBilling.mockResolvedValue(false);

    await expect(startBilling('order-1', WAITER)).resolves.toMatchObject({
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

    await expect(startBilling('order-1', WAITER)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });
});

describe('cancelBill', () => {
  const reopenedRow = {
    ...makeOrder({ status: 'ABIERTA' }),
    openedBy: 'waiter-1',
    openedAt: new Date('2026-11-07T18:00:00Z'),
    closedAt: null,
    discountAppliedBy: null,
    discountAppliedAt: null,
  };

  it('en_cobro -> ocupada: devuelve la Order del contrato y emite tras escribir', async () => {
    repo.findOrderForBill.mockResolvedValue(makeOrder({ status: 'EN_COBRO' }));
    repo.moveOrderBackToOpen.mockImplementation(async () => {
      expect(events.emitTableStatusChanged).not.toHaveBeenCalled();
      return reopenedRow;
    });
    getTableStatus.mockResolvedValue({ ...TABLE_STATUS, status: 'ocupada' });

    const order = await cancelBill('order-1', WAITER);

    expect(repo.moveOrderBackToOpen).toHaveBeenCalledWith('order-1', 'waiter-1');

    expect(order).toEqual({
      orderId: 'order-1',
      tableId: 'table-1',
      openedBy: 'waiter-1',
      waiterId: 'waiter-1',
      status: 'ABIERTA',
      openedAt: reopenedRow.openedAt,
      closedAt: null,
      discountAmount: 0,
      discountAppliedBy: null,
      discountAppliedAt: null,
    });
    expect(events.emitTableStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ocupada' }),
    );
  });

  it.each(['ABIERTA', 'CERRADA'])('con la orden %s responde 409 sin escribir', async (status) => {
    repo.findOrderForBill.mockResolvedValue(makeOrder({ status }));

    await expect(cancelBill('order-1', WAITER)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
    });
    expect(repo.moveOrderBackToOpen).not.toHaveBeenCalled();
  });

  it('si otro dispositivo la cancelo o se pago en medio: 409 y sin evento', async () => {
    repo.findOrderForBill.mockResolvedValue(makeOrder({ status: 'EN_COBRO' }));
    repo.moveOrderBackToOpen.mockResolvedValue(null);

    await expect(cancelBill('order-1', WAITER)).rejects.toMatchObject({ status: 409 });
    expect(events.emitTableStatusChanged).not.toHaveBeenCalled();
  });

  it('otro mesero 403, ADMIN permitido, orden inexistente 404', async () => {
    repo.findOrderForBill.mockResolvedValue(makeOrder({ status: 'EN_COBRO' }));
    repo.moveOrderBackToOpen.mockResolvedValue(reopenedRow);

    await expect(cancelBill('order-1', OTHER)).rejects.toMatchObject({ status: 403 });
    await expect(cancelBill('order-1', ADMIN)).resolves.toMatchObject({ status: 'ABIERTA' });

    repo.findOrderForBill.mockResolvedValue(null);
    await expect(cancelBill('order-1', WAITER)).rejects.toMatchObject({ status: 404 });
  });
});
