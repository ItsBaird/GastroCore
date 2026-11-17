// GC-RPT-0002 (GC-157). Reglas del servicio de correccion del metodo de pago; los repositorios van simulados.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../repositories/paymentCorrection.repository.js', () => ({
  findPaymentOfOrder: vi.fn(),
  correctPaymentMethod: vi.fn(),
}));
vi.mock('../repositories/paymentMethod.repository.js', () => ({ findPaymentMethodById: vi.fn() }));
vi.mock('../repositories/bill.repository.js', () => ({}));
vi.mock('../repositories/payment.repository.js', () => ({}));
vi.mock('../realtime/events.js', () => ({}));
vi.mock('./tableStatus.service.js', () => ({}));

const repo = await import('../repositories/paymentCorrection.repository.js');
const methodRepo = await import('../repositories/paymentMethod.repository.js');
const { correctOrderPaymentMethod } = await import('./paymentCorrection.service.js');

const ADMIN = { userId: 'admin-1', role: 'ADMIN', permissions: [] };
const CASH = { paymentMethodId: 'm-cash', name: 'Efectivo', isCash: true, isActive: true };
const CARD = { paymentMethodId: 'm-card', name: 'Tarjeta', isCash: false, isActive: true };
const CLOSED_AT = new Date('2026-11-14T20:00:00Z');

function payment(overrides = {}) {
  return {
    paymentId: 'pay-1',
    orderId: 'order-1',
    paymentMethodId: 'm-cash',
    subtotal: 100000,
    discountAmount: 10000,
    total: 90000,
    amountReceived: 100000,
    changeGiven: 10000,
    registeredBy: 'waiter-1',
    paidAt: CLOSED_AT,
    ...overrides,
  };
}
const order = (overrides = {}) => ({
  orderId: 'order-1',
  status: 'CERRADA',
  closedAt: CLOSED_AT,
  payment: payment(),
  ...overrides,
});

const methods = { 'm-cash': CASH, 'm-card': CARD };
const body = (extra = {}) => ({
  paymentMethodId: 'm-card',
  reason: 'Se cobro con tarjeta',
  ...extra,
});

beforeEach(() => {
  vi.resetAllMocks();
  repo.findPaymentOfOrder.mockResolvedValue(order());
  methodRepo.findPaymentMethodById.mockImplementation(async (id) => methods[id] ?? null);
  repo.correctPaymentMethod.mockImplementation(async ({ update }) => ({
    payment: payment({ ...update }),
  }));
});

describe('correctOrderPaymentMethod: caso feliz', () => {
  it('efectivo -> tarjeta: cambia el metodo y deja recibido y cambio en null; total intacto', async () => {
    const out = await correctOrderPaymentMethod('order-1', body(), ADMIN);

    const arg = repo.correctPaymentMethod.mock.calls[0][0];
    expect(arg).toMatchObject({
      orderId: 'order-1',
      paymentId: 'pay-1',
      closedAt: CLOSED_AT,
      userId: 'admin-1',
      expectedMethodId: 'm-cash',
      update: { paymentMethodId: 'm-card', amountReceived: null, changeGiven: null },
    });
    expect(arg.update).not.toHaveProperty('total');
    expect(arg.update).not.toHaveProperty('subtotal');
    expect(arg.update).not.toHaveProperty('discountAmount');
    expect(out).toMatchObject({
      paymentMethodId: 'm-card',
      total: 90000,
      subtotal: 100000,
      discountAmount: 10000,
      amountReceived: null,
      changeGiven: null,
    });
  });

  it('tarjeta -> efectivo: el servidor calcula el cambio contra el total guardado (R4)', async () => {
    repo.findPaymentOfOrder.mockResolvedValue(
      order({
        payment: payment({ paymentMethodId: 'm-card', amountReceived: null, changeGiven: null }),
      }),
    );
    await correctOrderPaymentMethod(
      'order-1',
      body({ paymentMethodId: 'm-cash', amountReceived: 100000 }),
      ADMIN,
    );
    expect(repo.correctPaymentMethod.mock.calls[0][0].update).toEqual({
      paymentMethodId: 'm-cash',
      amountReceived: 100000,
      changeGiven: 10000,
    });
  });

  it('audita quien-que-cuanto: metodo anterior y nuevo con nombre, total, recibido anterior, motivo', async () => {
    await correctOrderPaymentMethod('order-1', body({ reason: 'Error al digitar' }), ADMIN);
    expect(repo.correctPaymentMethod.mock.calls[0][0].auditDetails).toEqual({
      paymentId: 'pay-1',
      previousMethodId: 'm-cash',
      previousMethod: 'Efectivo',
      newMethodId: 'm-card',
      newMethod: 'Tarjeta',
      total: 90000,
      previousAmountReceived: 100000,
      previousChangeGiven: 10000,
      amountReceived: null,
      changeGiven: null,
      reason: 'Error al digitar',
    });
  });
});

describe('correctOrderPaymentMethod: reglas', () => {
  it.each([
    ['la orden no existe', null],
    ['la orden no tiene pago', order({ payment: null })],
  ])('%s: 404 NOT_FOUND y no escribe', async (_label, found) => {
    repo.findPaymentOfOrder.mockResolvedValue(found);
    await expect(correctOrderPaymentMethod('order-1', body(), ADMIN)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
    expect(repo.correctPaymentMethod).not.toHaveBeenCalled();
  });

  it('orden no CERRADA: 409 INVALID_TRANSITION', async () => {
    repo.findPaymentOfOrder.mockResolvedValue(order({ status: 'EN_COBRO' }));
    await expect(correctOrderPaymentMethod('order-1', body(), ADMIN)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
    });
    expect(repo.correctPaymentMethod).not.toHaveBeenCalled();
  });

  it('el mismo metodo que ya tiene: 400 VALIDATION_ERROR (no hay nada que corregir)', async () => {
    await expect(
      correctOrderPaymentMethod(
        'order-1',
        body({ paymentMethodId: 'm-cash', amountReceived: 90000 }),
        ADMIN,
      ),
    ).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      details: { field: 'paymentMethodId' },
    });
    expect(repo.correctPaymentMethod).not.toHaveBeenCalled();
  });

  it('metodo inexistente: 404; inactivo: 409 PAYMENT_METHOD_INACTIVE', async () => {
    await expect(
      correctOrderPaymentMethod('order-1', body({ paymentMethodId: 'm-ghost' }), ADMIN),
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });

    methodRepo.findPaymentMethodById.mockImplementation(async (id) =>
      id === 'm-card' ? { ...CARD, isActive: false } : (methods[id] ?? null),
    );
    await expect(correctOrderPaymentMethod('order-1', body(), ADMIN)).rejects.toMatchObject({
      status: 409,
      code: 'PAYMENT_METHOD_INACTIVE',
    });
    expect(repo.correctPaymentMethod).not.toHaveBeenCalled();
  });

  it('nuevo metodo en efectivo sin monto: 400; con monto menor al total: 400 INSUFFICIENT_AMOUNT', async () => {
    repo.findPaymentOfOrder.mockResolvedValue(
      order({
        payment: payment({ paymentMethodId: 'm-card', amountReceived: null, changeGiven: null }),
      }),
    );
    await expect(
      correctOrderPaymentMethod('order-1', body({ paymentMethodId: 'm-cash' }), ADMIN),
    ).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      details: { field: 'amountReceived' },
    });
    await expect(
      correctOrderPaymentMethod(
        'order-1',
        body({ paymentMethodId: 'm-cash', amountReceived: 89999 }),
        ADMIN,
      ),
    ).rejects.toMatchObject({
      status: 400,
      code: 'INSUFFICIENT_AMOUNT',
      details: { total: 90000 },
    });
    expect(repo.correctPaymentMethod).not.toHaveBeenCalled();
  });

  it('monto recibido con un metodo que no es efectivo: 400', async () => {
    await expect(
      correctOrderPaymentMethod('order-1', body({ amountReceived: 90000 }), ADMIN),
    ).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      details: { field: 'amountReceived' },
    });
  });

  it('el pago cambio entre la lectura y la escritura: 409 INVALID_TRANSITION', async () => {
    repo.correctPaymentMethod.mockResolvedValue({ changed: true });
    await expect(correctOrderPaymentMethod('order-1', body(), ADMIN)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
    });
  });
});
