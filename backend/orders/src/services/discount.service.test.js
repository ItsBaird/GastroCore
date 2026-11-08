import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../repositories/bill.repository.js', () => ({
  findOrderForBill: vi.fn(),
  moveOrderToBilling: vi.fn(),
  moveOrderBackToOpen: vi.fn(),
  setOrderDiscount: vi.fn(),
}));
vi.mock('../realtime/events.js', () => ({
  emitOrderUpdated: vi.fn(),
  emitTableStatusChanged: vi.fn(),
}));
vi.mock('./tableStatus.service.js', () => ({ getTableStatus: vi.fn() }));

const repo = await import('../repositories/bill.repository.js');
const events = await import('../realtime/events.js');
const { applyDiscount } = await import('./discount.service.js');

const ADMIN = { userId: 'admin-1', role: 'ADMIN', permissions: [] };
const WAITER = { userId: 'waiter-1', role: 'WAITER', permissions: ['discount:apply'] };
const OTHER = { userId: 'waiter-2', role: 'WAITER', permissions: ['discount:apply'] };

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

// Subtotal 115.000: 2 x 35.000 + 45.000; el cancelado de 9.000 no cuenta (R3, sin cancelados)
function makeOrder({ status = 'EN_COBRO', discountAmount = 0, waiterId = 'waiter-1' } = {}) {
  return {
    orderId: 'order-1',
    tableId: 'table-1',
    waiterId,
    status,
    discountAmount,
    table: { tableId: 'table-1', tableNumber: 7 },
    rounds: [
      {
        items: [
          row('a', 'entregado', 35000, 2),
          row('b', 'listo', 45000, 1),
          row('c', 'cancelado', 9000, 1),
        ],
      },
    ],
  };
}

beforeEach(() => vi.resetAllMocks());

describe('applyDiscount: aplicar', () => {
  it('registra el descuento, audita y responde la cuenta recalculada', async () => {
    repo.findOrderForBill
      .mockResolvedValueOnce(makeOrder())
      .mockResolvedValueOnce(makeOrder({ discountAmount: 15000 }));
    repo.setOrderDiscount.mockImplementation(async () => {
      expect(events.emitOrderUpdated).not.toHaveBeenCalled();
      return true;
    });

    const bill = await applyDiscount(
      'order-1',
      { discountAmount: 15000, reason: 'Cliente frecuente' },
      ADMIN,
    );

    expect(repo.setOrderDiscount).toHaveBeenCalledWith({
      orderId: 'order-1',
      previousAmount: 0,
      amount: 15000,
      userId: 'admin-1',
      auditDetails: {
        tableNumber: 7,
        previousAmount: 0,
        newAmount: 15000,
        subtotal: 115000,
        total: 100000,
        authorizedBy: 'role:ADMIN',
        reason: 'Cliente frecuente',
      },
    });
    expect(bill).toMatchObject({ subtotal: 115000, discountAmount: 15000, total: 100000 });
    expect(events.emitOrderUpdated).toHaveBeenCalledWith(
      { orderId: 'order-1', tableNumber: 7, status: 'EN_COBRO', discountAmount: 15000 },
      'waiter-1',
    );
  });

  it('un WAITER con el permiso y la mesa asignada puede, y la auditoria lo dice', async () => {
    repo.findOrderForBill
      .mockResolvedValueOnce(makeOrder())
      .mockResolvedValueOnce(makeOrder({ discountAmount: 1000 }));
    repo.setOrderDiscount.mockResolvedValue(true);

    await applyDiscount('order-1', { discountAmount: 1000 }, WAITER);

    expect(repo.setOrderDiscount.mock.calls[0][0].auditDetails).toMatchObject({
      authorizedBy: 'permission:discount:apply',
    });
    expect(repo.setOrderDiscount.mock.calls[0][0].auditDetails).not.toHaveProperty('reason');
  });

  it('un WAITER con el permiso pero de otra mesa recibe 403', async () => {
    repo.findOrderForBill.mockResolvedValue(makeOrder());

    await expect(applyDiscount('order-1', { discountAmount: 1000 }, OTHER)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(repo.setOrderDiscount).not.toHaveBeenCalled();
  });

  it('igual al subtotal se permite: cortesia total, total 0', async () => {
    repo.findOrderForBill
      .mockResolvedValueOnce(makeOrder())
      .mockResolvedValueOnce(makeOrder({ discountAmount: 115000 }));
    repo.setOrderDiscount.mockResolvedValue(true);

    await expect(
      applyDiscount('order-1', { discountAmount: 115000 }, ADMIN),
    ).resolves.toMatchObject({
      total: 0,
    });
  });

  it('mayor que el subtotal: 400 VALIDATION_ERROR con el subtotal, sin escribir', async () => {
    repo.findOrderForBill.mockResolvedValue(makeOrder());

    await expect(applyDiscount('order-1', { discountAmount: 115001 }, ADMIN)).rejects.toMatchObject(
      {
        status: 400,
        code: 'VALIDATION_ERROR',
        details: { field: 'discountAmount', subtotal: 115000, discountAmount: 115001 },
      },
    );
    expect(repo.setOrderDiscount).not.toHaveBeenCalled();
  });
});

describe('applyDiscount: reemplazar, quitar e idempotencia', () => {
  it('un monto nuevo reemplaza al anterior y la auditoria guarda el previo', async () => {
    repo.findOrderForBill
      .mockResolvedValueOnce(makeOrder({ discountAmount: 5000 }))
      .mockResolvedValueOnce(makeOrder({ discountAmount: 8000 }));
    repo.setOrderDiscount.mockResolvedValue(true);

    await applyDiscount('order-1', { discountAmount: 8000 }, ADMIN);

    expect(repo.setOrderDiscount).toHaveBeenCalledWith(
      expect.objectContaining({
        previousAmount: 5000,
        amount: 8000,
        auditDetails: expect.objectContaining({ previousAmount: 5000, newAmount: 8000 }),
      }),
    );
  });

  it('0 quita el descuento', async () => {
    repo.findOrderForBill
      .mockResolvedValueOnce(makeOrder({ discountAmount: 5000 }))
      .mockResolvedValueOnce(makeOrder({ discountAmount: 0 }));
    repo.setOrderDiscount.mockResolvedValue(true);

    const bill = await applyDiscount('order-1', { discountAmount: 0 }, ADMIN);

    expect(repo.setOrderDiscount).toHaveBeenCalledWith(expect.objectContaining({ amount: 0 }));
    expect(bill).toMatchObject({ discountAmount: 0, total: 115000 });
  });

  it('el mismo monto vigente es idempotente: 200 sin escribir, sin auditoria ni evento', async () => {
    repo.findOrderForBill.mockResolvedValue(makeOrder({ discountAmount: 5000 }));

    await expect(applyDiscount('order-1', { discountAmount: 5000 }, ADMIN)).resolves.toMatchObject({
      discountAmount: 5000,
    });
    expect(repo.setOrderDiscount).not.toHaveBeenCalled();
    expect(events.emitOrderUpdated).not.toHaveBeenCalled();
  });
});

describe('applyDiscount: estado y carreras', () => {
  it.each(['ABIERTA', 'CERRADA'])('con la orden %s responde 409 sin escribir', async (status) => {
    repo.findOrderForBill.mockResolvedValue(makeOrder({ status }));

    await expect(applyDiscount('order-1', { discountAmount: 1000 }, ADMIN)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
    });
    expect(repo.setOrderDiscount).not.toHaveBeenCalled();
  });

  it('orden inexistente: 404', async () => {
    repo.findOrderForBill.mockResolvedValue(null);

    await expect(applyDiscount('order-1', { discountAmount: 1000 }, ADMIN)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('se cancelo el cobro entre la lectura y la escritura: 0 filas -> 409 y sin evento', async () => {
    repo.findOrderForBill
      .mockResolvedValueOnce(makeOrder())
      .mockResolvedValueOnce(makeOrder({ status: 'ABIERTA' }));
    repo.setOrderDiscount.mockResolvedValue(false);

    await expect(applyDiscount('order-1', { discountAmount: 1000 }, ADMIN)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
    });
    expect(events.emitOrderUpdated).not.toHaveBeenCalled();
  });

  it('otro dispositivo cambio el descuento en medio: 409 y sin evento', async () => {
    repo.findOrderForBill
      .mockResolvedValueOnce(makeOrder())
      .mockResolvedValueOnce(makeOrder({ discountAmount: 3000 }));
    repo.setOrderDiscount.mockResolvedValue(false);

    await expect(applyDiscount('order-1', { discountAmount: 1000 }, ADMIN)).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/cambió/),
    });
    expect(events.emitOrderUpdated).not.toHaveBeenCalled();
  });

  it('si la auditoria falla, el error se propaga y no se emite nada', async () => {
    repo.findOrderForBill.mockResolvedValue(makeOrder());
    repo.setOrderDiscount.mockRejectedValue(new Error('audit_log no disponible'));

    await expect(applyDiscount('order-1', { discountAmount: 1000 }, ADMIN)).rejects.toThrow(
      'audit_log no disponible',
    );
    expect(events.emitOrderUpdated).not.toHaveBeenCalled();
  });
});
