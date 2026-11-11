// POST /api/orders/:orderId/pay con la app real: roles, codigo 201 y validacion estricta del cuerpo (R4/R5).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerPayment } from '../services/payment.service.js';
import { call, startApp, tokenFor } from '../test/helpers.js';

vi.mock('../config/prisma.js', () => ({ prisma: {} }));
vi.mock('../services/payment.service.js', () => ({ registerPayment: vi.fn() }));

const ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const METHOD_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const WAITER_ID = '22222222-2222-4222-8222-222222222222';
const URL = `/api/orders/${ORDER_ID}/pay`;
const PAYMENT = { paymentId: 'p1', orderId: ORDER_ID, total: 45000, changeGiven: 5000 };

let app;

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  registerPayment.mockResolvedValue(PAYMENT);
});

const post = (token, body) => call(app.base, 'POST', URL, { token, body });

describe('POST /api/orders/:orderId/pay: roles', () => {
  it('el WAITER llega al servicio (que valida la mesa) y responde 201 con el Payment', async () => {
    const body = { paymentMethodId: METHOD_ID, amountReceived: 50000 };
    const res = await post(tokenFor('WAITER', { userId: WAITER_ID }), body);

    expect(res.status).toBe(201);
    expect(res.body).toEqual(PAYMENT);
    expect(registerPayment).toHaveBeenCalledWith(
      ORDER_ID,
      body,
      expect.objectContaining({ userId: WAITER_ID, role: 'WAITER' }),
    );
  });

  it('el ADMIN tambien', async () => {
    expect((await post(tokenFor('ADMIN'), { paymentMethodId: METHOD_ID })).status).toBe(201);
  });

  it('sin token 401 y COOK 403', async () => {
    expect((await post(undefined, { paymentMethodId: METHOD_ID })).status).toBe(401);
    expect((await post(tokenFor('COOK'), { paymentMethodId: METHOD_ID })).status).toBe(403);
    expect(registerPayment).not.toHaveBeenCalled();
  });
});

describe('POST /api/orders/:orderId/pay: validacion', () => {
  it.each([
    ['sin metodo', { amountReceived: 1000 }],
    ['metodo que no es UUID', { paymentMethodId: 'efectivo' }],
    ['monto decimal', { paymentMethodId: METHOD_ID, amountReceived: 1000.5 }],
    ['monto negativo', { paymentMethodId: METHOD_ID, amountReceived: -1 }],
    ['monto texto', { paymentMethodId: METHOD_ID, amountReceived: '50000' }],
    ['total (R4)', { paymentMethodId: METHOD_ID, total: 0 }],
    ['changeGiven (R4)', { paymentMethodId: METHOD_ID, amountReceived: 1, changeGiven: 0 }],
    ['discountAmount (R4)', { paymentMethodId: METHOD_ID, discountAmount: 0 }],
    ['expectedTotal', { paymentMethodId: METHOD_ID, expectedTotal: 45000 }],
    ['registeredBy (R4)', { paymentMethodId: METHOD_ID, registeredBy: WAITER_ID }],
  ])('%s responde 400', async (_label, body) => {
    const res = await post(tokenFor('ADMIN'), body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(registerPayment).not.toHaveBeenCalled();
  });

  it('sin cuerpo responde 400', async () => {
    const res = await post(tokenFor('ADMIN'));
    expect(res.status).toBe(400);
    expect(registerPayment).not.toHaveBeenCalled();
  });

  it('orderId que no es UUID responde 400', async () => {
    const res = await call(app.base, 'POST', '/api/orders/no-uuid/pay', {
      token: tokenFor('ADMIN'),
      body: { paymentMethodId: METHOD_ID },
    });
    expect(res.status).toBe(400);
  });

  it('los errores del servicio salen en el formato del contrato', async () => {
    const { AppError } = await import('../errors/AppError.js');
    registerPayment.mockRejectedValue(
      new AppError({
        status: 400,
        code: 'INSUFFICIENT_AMOUNT',
        message: 'El monto recibido no alcanza para el total',
        details: { total: 45000, amountReceived: 40000 },
      }),
    );

    const res = await post(tokenFor('ADMIN'), {
      paymentMethodId: METHOD_ID,
      amountReceived: 40000,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'INSUFFICIENT_AMOUNT',
      details: { total: 45000, amountReceived: 40000 },
    });
  });
});
