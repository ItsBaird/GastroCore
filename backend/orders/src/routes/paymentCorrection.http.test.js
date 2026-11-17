// Correccion del metodo de pago (GC-RPT-0002, GC-157) con la app real (rutas, JWT, validacion, errores).
// Solo los repositorios van simulados: no hace falta base de datos.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  correctPaymentMethod,
  findPaymentOfOrder,
} from '../repositories/paymentCorrection.repository.js';
import { findPaymentMethodById } from '../repositories/paymentMethod.repository.js';
import { ADMIN_ID, call, MISSING_ID, startApp, tokenFor } from '../test/helpers.js';

vi.mock('../config/prisma.js', () => ({ prisma: {} }));
vi.mock('../repositories/paymentCorrection.repository.js', () => ({
  findPaymentOfOrder: vi.fn(),
  correctPaymentMethod: vi.fn(),
}));
vi.mock('../repositories/paymentMethod.repository.js', () => ({
  findPaymentMethodById: vi.fn(),
  findPaymentMethodByName: vi.fn(),
  findAllPaymentMethods: vi.fn(),
  countPaymentsByMethod: vi.fn(),
  createPaymentMethod: vi.fn(),
  updatePaymentMethod: vi.fn(),
}));

const ORDER = '77777777-7777-4777-8777-777777777777';
const CASH = '11111111-1111-4111-8111-111111111111';
const CARD = '22222222-2222-4222-8222-222222222222';
const CLOSED_AT = new Date('2026-11-14T20:00:00Z');
const URL = `/api/orders/${ORDER}/payment`;

const stored = {
  paymentId: '88888888-8888-4888-8888-888888888888',
  orderId: ORDER,
  paymentMethodId: CASH,
  subtotal: 100000,
  discountAmount: 10000,
  total: 90000,
  amountReceived: 100000,
  changeGiven: 10000,
  registeredBy: ADMIN_ID,
  paidAt: CLOSED_AT,
};
const methods = {
  [CASH]: { paymentMethodId: CASH, name: 'Efectivo', isCash: true, isActive: true },
  [CARD]: { paymentMethodId: CARD, name: 'Tarjeta', isCash: false, isActive: true },
};

let app;
// Sin token: pasar null (un undefined activaria el valor por defecto, un token de ADMIN)
const patch = (body, token = tokenFor('ADMIN'), url = URL) =>
  call(app.base, 'PATCH', url, { token, body });
const valid = (extra = {}) => ({ paymentMethodId: CARD, reason: 'Se cobro con tarjeta', ...extra });

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  findPaymentOfOrder.mockResolvedValue({
    orderId: ORDER,
    status: 'CERRADA',
    closedAt: CLOSED_AT,
    payment: stored,
  });
  findPaymentMethodById.mockImplementation(async (id) => methods[id] ?? null);
  correctPaymentMethod.mockImplementation(async ({ update }) => ({
    payment: { ...stored, ...update },
  }));
});

describe('acceso: solo el ADMIN', () => {
  it('sin sesion -> 401', async () => {
    expect((await patch(valid(), null)).status).toBe(401);
    expect(correctPaymentMethod).not.toHaveBeenCalled();
  });

  it.each(['WAITER', 'COOK'])('un %s -> 403 y no escribe nada', async (role) => {
    const res = await patch(valid(), tokenFor(role));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(findPaymentOfOrder).not.toHaveBeenCalled();
    expect(correctPaymentMethod).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/orders/:orderId/payment', () => {
  it('criterio 3: el ADMIN corrige y responde 200 con el pago; el total no cambia', async () => {
    const res = await patch(valid());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      paymentId: stored.paymentId,
      paymentMethodId: CARD,
      subtotal: 100000,
      discountAmount: 10000,
      total: 90000,
      amountReceived: null,
      changeGiven: null,
    });
  });

  it('quien corrige sale del token y el motivo llega recortado a la auditoria', async () => {
    await patch(valid({ reason: '   Error al digitar   ' }));
    const arg = correctPaymentMethod.mock.calls[0][0];
    expect(arg.userId).toBe(ADMIN_ID);
    expect(arg.auditDetails.reason).toBe('Error al digitar');
  });

  it('orden sin pago o inexistente -> 404; no cerrada -> 409', async () => {
    findPaymentOfOrder.mockResolvedValue(null);
    expect((await patch(valid())).status).toBe(404);
    findPaymentOfOrder.mockResolvedValue({
      orderId: ORDER,
      status: 'EN_COBRO',
      closedAt: null,
      payment: stored,
    });
    const res = await patch(valid());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
    expect(correctPaymentMethod).not.toHaveBeenCalled();
  });

  it('metodo inactivo -> 409 PAYMENT_METHOD_INACTIVE', async () => {
    findPaymentMethodById.mockImplementation(async (id) =>
      id === CARD ? { ...methods[CARD], isActive: false } : (methods[id] ?? null),
    );
    const res = await patch(valid());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PAYMENT_METHOD_INACTIVE');
  });
});

describe('validacion (400)', () => {
  it.each([
    ['sin cuerpo', undefined],
    ['sin motivo', { paymentMethodId: CARD }],
    ['motivo vacio', { paymentMethodId: CARD, reason: '' }],
    ['motivo de solo espacios', { paymentMethodId: CARD, reason: '        ' }],
    ['motivo muy corto', { paymentMethodId: CARD, reason: 'ab' }],
    ['motivo muy largo', { paymentMethodId: CARD, reason: 'x'.repeat(201) }],
    ['sin metodo', { reason: 'Se cobro con tarjeta' }],
    ['metodo que no es UUID', { paymentMethodId: 'tarjeta', reason: 'Se cobro con tarjeta' }],
    ['monto negativo', valid({ amountReceived: -1 })],
    ['monto con decimales', valid({ amountReceived: 10.5 })],
    ['R4: total en el cuerpo', valid({ total: 1 })],
    ['R4: descuento en el cuerpo', valid({ discountAmount: 0 })],
  ])('%s', async (_label, body) => {
    const res = await patch(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(correctPaymentMethod).not.toHaveBeenCalled();
  });

  it('orderId que no es UUID -> 400', async () => {
    const res = await patch(valid(), tokenFor('ADMIN'), '/api/orders/no-es-uuid/payment');
    expect(res.status).toBe(400);
  });

  it('el mismo metodo que ya tiene -> 400', async () => {
    const res = await patch(valid({ paymentMethodId: CASH, amountReceived: 90000 }));
    expect(res.status).toBe(400);
    expect(res.body.error.details).toMatchObject({ field: 'paymentMethodId' });
  });

  it('metodo inexistente -> 404', async () => {
    expect((await patch(valid({ paymentMethodId: MISSING_ID }))).status).toBe(404);
  });
});
