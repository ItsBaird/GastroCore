import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../repositories/bill.repository.js', () => ({
  findOrderForBill: vi.fn(),
  moveOrderToBilling: vi.fn(),
  moveOrderBackToOpen: vi.fn(),
  setOrderDiscount: vi.fn(),
}));
vi.mock('../repositories/payment.repository.js', () => ({ closeOrderWithPayment: vi.fn() }));
vi.mock('../repositories/paymentMethod.repository.js', () => ({ findPaymentMethodById: vi.fn() }));
vi.mock('../realtime/events.js', () => ({
  emitOrderUpdated: vi.fn(),
  emitTableStatusChanged: vi.fn(),
}));
vi.mock('./tableStatus.service.js', () => ({ getTableStatus: vi.fn() }));

const billRepo = await import('../repositories/bill.repository.js');
const paymentRepo = await import('../repositories/payment.repository.js');
const methodRepo = await import('../repositories/paymentMethod.repository.js');
const events = await import('../realtime/events.js');
const tableStatus = await import('./tableStatus.service.js');
const { registerPayment } = await import('./payment.service.js');

const WAITER = { userId: 'waiter-1', role: 'WAITER', permissions: [] };
const OTHER = { userId: 'waiter-2', role: 'WAITER', permissions: [] };
const ADMIN = { userId: 'admin-1', role: 'ADMIN', permissions: [] };

const CASH = { paymentMethodId: 'm-cash', name: 'Efectivo', isCash: true, isActive: true };
const CARD = {
  paymentMethodId: 'm-card',
  name: 'Tarjeta de Credito/Debito',
  isCash: false,
  isActive: true,
};

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

// Subtotal 115.000 (2 x 35.000 + 45.000); el cancelado de 9.000 no cuenta (R3)
function makeOrder({
  status = 'EN_COBRO',
  discountAmount = 0,
  discountAppliedBy = null,
  waiterId = 'waiter-1',
  items,
} = {}) {
  return {
    orderId: 'order-1',
    tableId: 'table-1',
    openedBy: 'waiter-0',
    waiterId,
    status,
    discountAmount,
    discountAppliedBy,
    table: { tableId: 'table-1', tableNumber: 7 },
    rounds: [
      {
        items: items ?? [
          row('a', 'entregado', 35000, 2),
          row('b', 'entregado', 45000, 1),
          row('c', 'cancelado', 9000, 1),
        ],
      },
    ],
  };
}

// El repositorio devuelve la fila creada: se simula con lo que recibio
function echoPayment() {
  paymentRepo.closeOrderWithPayment.mockImplementation(async ({ orderId, payment, userId }) => ({
    payment: {
      paymentId: 'pay-1',
      orderId,
      ...payment,
      registeredBy: userId,
      paidAt: new Date('2026-11-08T20:00:00Z'),
    },
    rejectedQrRequests: 0,
    attendedServiceCalls: 0,
  }));
}

beforeEach(() => {
  vi.resetAllMocks();
  echoPayment();
  tableStatus.getTableStatus.mockResolvedValue({ tableId: 'table-1', status: 'libre' });
});

describe('registerPayment: efectivo', () => {
  it('calcula el cambio en el servidor, cierra la orden y devuelve el Payment', async () => {
    billRepo.findOrderForBill.mockResolvedValue(makeOrder());
    methodRepo.findPaymentMethodById.mockResolvedValue(CASH);

    const payment = await registerPayment(
      'order-1',
      { paymentMethodId: 'm-cash', amountReceived: 120000 },
      WAITER,
    );

    expect(payment).toEqual({
      paymentId: 'pay-1',
      orderId: 'order-1',
      paymentMethodId: 'm-cash',
      subtotal: 115000,
      discountAmount: 0,
      total: 115000,
      amountReceived: 120000,
      changeGiven: 5000,
      registeredBy: 'waiter-1',
      paidAt: new Date('2026-11-08T20:00:00Z'),
    });
    expect(paymentRepo.closeOrderWithPayment).toHaveBeenCalledWith({
      orderId: 'order-1',
      tableId: 'table-1',
      userId: 'waiter-1',
      payment: {
        paymentMethodId: 'm-cash',
        subtotal: 115000,
        discountAmount: 0,
        discountAppliedBy: null,
        total: 115000,
        amountReceived: 120000,
        changeGiven: 5000,
      },
      auditDetails: {
        tableNumber: 7,
        paymentMethodId: 'm-cash',
        paymentMethod: 'Efectivo',
        subtotal: 115000,
        discountAmount: 0,
        total: 115000,
        amountReceived: 120000,
        changeGiven: 5000,
      },
    });
  });

  it('monto exacto: cambio 0', async () => {
    billRepo.findOrderForBill.mockResolvedValue(makeOrder());
    methodRepo.findPaymentMethodById.mockResolvedValue(CASH);

    const payment = await registerPayment(
      'order-1',
      { paymentMethodId: 'm-cash', amountReceived: 115000 },
      WAITER,
    );

    expect(payment.changeGiven).toBe(0);
  });

  it('con descuento cobra el total con descuento y guarda quien lo aplico', async () => {
    billRepo.findOrderForBill.mockResolvedValue(
      makeOrder({ discountAmount: 15000, discountAppliedBy: 'admin-1' }),
    );
    methodRepo.findPaymentMethodById.mockResolvedValue(CASH);

    const payment = await registerPayment(
      'order-1',
      { paymentMethodId: 'm-cash', amountReceived: 100000 },
      WAITER,
    );

    expect(payment).toMatchObject({ subtotal: 115000, discountAmount: 15000, total: 100000 });
    expect(payment.changeGiven).toBe(0);
    expect(paymentRepo.closeOrderWithPayment.mock.calls[0][0].payment.discountAppliedBy).toBe(
      'admin-1',
    );
  });

  it('insuficiente: 400 INSUFFICIENT_AMOUNT con el total vigente y no escribe nada', async () => {
    billRepo.findOrderForBill.mockResolvedValue(makeOrder());
    methodRepo.findPaymentMethodById.mockResolvedValue(CASH);

    await expect(
      registerPayment('order-1', { paymentMethodId: 'm-cash', amountReceived: 114999 }, WAITER),
    ).rejects.toMatchObject({
      status: 400,
      code: 'INSUFFICIENT_AMOUNT',
      details: { total: 115000, amountReceived: 114999 },
    });
    expect(paymentRepo.closeOrderWithPayment).not.toHaveBeenCalled();
    expect(events.emitTableStatusChanged).not.toHaveBeenCalled();
  });

  it('sin amountReceived: 400 VALIDATION_ERROR', async () => {
    billRepo.findOrderForBill.mockResolvedValue(makeOrder());
    methodRepo.findPaymentMethodById.mockResolvedValue(CASH);

    await expect(
      registerPayment('order-1', { paymentMethodId: 'm-cash' }, WAITER),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(paymentRepo.closeOrderWithPayment).not.toHaveBeenCalled();
  });

  it('total 0 (descuento igual al subtotal) se puede pagar con 0', async () => {
    billRepo.findOrderForBill.mockResolvedValue(
      makeOrder({ discountAmount: 115000, discountAppliedBy: 'admin-1' }),
    );
    methodRepo.findPaymentMethodById.mockResolvedValue(CASH);

    const payment = await registerPayment(
      'order-1',
      { paymentMethodId: 'm-cash', amountReceived: 0 },
      ADMIN,
    );

    expect(payment).toMatchObject({ total: 0, amountReceived: 0, changeGiven: 0 });
  });
});

describe('registerPayment: sin efectivo', () => {
  it('guarda recibido y cambio en null', async () => {
    billRepo.findOrderForBill.mockResolvedValue(makeOrder());
    methodRepo.findPaymentMethodById.mockResolvedValue(CARD);

    const payment = await registerPayment('order-1', { paymentMethodId: 'm-card' }, WAITER);

    expect(payment).toMatchObject({ total: 115000, amountReceived: null, changeGiven: null });
    expect(paymentRepo.closeOrderWithPayment.mock.calls[0][0].auditDetails.paymentMethod).toBe(
      'Tarjeta de Credito/Debito',
    );
  });

  it('con amountReceived: 400 VALIDATION_ERROR', async () => {
    billRepo.findOrderForBill.mockResolvedValue(makeOrder());
    methodRepo.findPaymentMethodById.mockResolvedValue(CARD);

    await expect(
      registerPayment('order-1', { paymentMethodId: 'm-card', amountReceived: 115000 }, WAITER),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(paymentRepo.closeOrderWithPayment).not.toHaveBeenCalled();
  });
});

describe('registerPayment: eventos', () => {
  it('tras el commit avisa mesa libre a waiters y order:updated CERRADA al mesero actual', async () => {
    billRepo.findOrderForBill.mockResolvedValue(makeOrder());
    methodRepo.findPaymentMethodById.mockResolvedValue(CARD);

    await registerPayment('order-1', { paymentMethodId: 'm-card' }, ADMIN);

    expect(tableStatus.getTableStatus).toHaveBeenCalledWith('table-1');
    expect(events.emitTableStatusChanged).toHaveBeenCalledWith({
      tableId: 'table-1',
      status: 'libre',
    });
    expect(events.emitOrderUpdated).toHaveBeenCalledWith(
      { orderId: 'order-1', tableNumber: 7, status: 'CERRADA', discountAmount: 0 },
      'waiter-1',
    );
  });

  it('si falla el aviso en tiempo real el pago ya quedo: responde igual', async () => {
    billRepo.findOrderForBill.mockResolvedValue(makeOrder());
    methodRepo.findPaymentMethodById.mockResolvedValue(CARD);
    tableStatus.getTableStatus.mockRejectedValue(new Error('db caida'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      registerPayment('order-1', { paymentMethodId: 'm-card' }, WAITER),
    ).resolves.toMatchObject({ paymentId: 'pay-1' });
    spy.mockRestore();
  });
});

describe('registerPayment: reglas', () => {
  it('orden inexistente: 404', async () => {
    billRepo.findOrderForBill.mockResolvedValue(null);

    await expect(
      registerPayment('order-1', { paymentMethodId: 'm-card' }, WAITER),
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('otro mesero: 403 y el ADMIN si puede', async () => {
    billRepo.findOrderForBill.mockResolvedValue(makeOrder());
    methodRepo.findPaymentMethodById.mockResolvedValue(CARD);

    await expect(
      registerPayment('order-1', { paymentMethodId: 'm-card' }, OTHER),
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    await expect(
      registerPayment('order-1', { paymentMethodId: 'm-card' }, ADMIN),
    ).resolves.toMatchObject({ registeredBy: 'admin-1' });
  });

  it.each([
    ['ABIERTA', 'Solo se puede cobrar una mesa en cobro'],
    ['CERRADA', 'La orden ya fue pagada'],
  ])('orden %s: 409 INVALID_TRANSITION', async (status, message) => {
    billRepo.findOrderForBill.mockResolvedValue(makeOrder({ status }));

    await expect(
      registerPayment('order-1', { paymentMethodId: 'm-card' }, WAITER),
    ).rejects.toMatchObject({ status: 409, code: 'INVALID_TRANSITION', message });
    expect(methodRepo.findPaymentMethodById).not.toHaveBeenCalled();
  });

  it('items vivos sin entregar: 409 con details.items (cancelados y entregados no bloquean)', async () => {
    billRepo.findOrderForBill.mockResolvedValue(
      makeOrder({
        items: [
          row('a', 'entregado', 35000, 1),
          row('b', 'listo', 45000, 1),
          row('c', 'en_preparacion', 9000, 1),
          row('d', 'pendiente', 9000, 1),
          row('e', 'cancelado', 9000, 1),
        ],
      }),
    );

    await expect(
      registerPayment('order-1', { paymentMethodId: 'm-card' }, WAITER),
    ).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
      details: {
        items: [
          { itemId: 'b', productName: 'Prod b', status: 'listo' },
          { itemId: 'c', productName: 'Prod c', status: 'en_preparacion' },
          { itemId: 'd', productName: 'Prod d', status: 'pendiente' },
        ],
      },
    });
    expect(paymentRepo.closeOrderWithPayment).not.toHaveBeenCalled();
  });

  it('metodo inexistente: 404; inactivo: 409 PAYMENT_METHOD_INACTIVE', async () => {
    billRepo.findOrderForBill.mockResolvedValue(makeOrder());

    methodRepo.findPaymentMethodById.mockResolvedValue(null);
    await expect(
      registerPayment('order-1', { paymentMethodId: 'm-x' }, WAITER),
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });

    methodRepo.findPaymentMethodById.mockResolvedValue({ ...CARD, isActive: false });
    await expect(
      registerPayment('order-1', { paymentMethodId: 'm-card' }, WAITER),
    ).rejects.toMatchObject({ status: 409, code: 'PAYMENT_METHOD_INACTIVE' });
    expect(paymentRepo.closeOrderWithPayment).not.toHaveBeenCalled();
  });

  it.each([
    ['otro dispositivo ya cobro', 'CERRADA', 'La orden ya fue pagada'],
    ['se cancelo el cobro en medio', 'ABIERTA', 'La mesa ya no está en cobro'],
    [
      'cambio el descuento en medio',
      'EN_COBRO',
      'La cuenta cambió mientras cobrabas; revísala e inténtalo de nuevo',
    ],
  ])('carrera (%s): 409 sin eventos', async (_label, freshStatus, message) => {
    billRepo.findOrderForBill
      .mockResolvedValueOnce(makeOrder())
      .mockResolvedValueOnce(makeOrder({ status: freshStatus }));
    methodRepo.findPaymentMethodById.mockResolvedValue(CARD);
    paymentRepo.closeOrderWithPayment.mockResolvedValue(null);

    await expect(
      registerPayment('order-1', { paymentMethodId: 'm-card' }, WAITER),
    ).rejects.toMatchObject({ status: 409, code: 'INVALID_TRANSITION', message });
    expect(events.emitTableStatusChanged).not.toHaveBeenCalled();
    expect(events.emitOrderUpdated).not.toHaveBeenCalled();
  });
});
