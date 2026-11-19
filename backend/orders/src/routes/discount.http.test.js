// POST /api/orders/:orderId/discount con la app real: permiso del JWT, roles y validacion (R4/R5).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyDiscount } from '../services/discount.service.js';
import { call, startApp, tokenFor } from '../test/helpers.js';

vi.mock('../config/prisma.js', () => ({ prisma: {} }));
vi.mock('../services/discount.service.js', () => ({ applyDiscount: vi.fn() }));

const ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const WAITER_ID = '22222222-2222-4222-8222-222222222222';
const URL = `/api/orders/${ORDER_ID}/discount`;
const BILL = { orderId: ORDER_ID, subtotal: 50000, discountAmount: 5000, total: 45000 };

let app;

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  applyDiscount.mockResolvedValue(BILL);
});

const post = (token, body) => call(app.base, 'POST', URL, { token, body });
const waiter = (permissions = []) => tokenFor('WAITER', { userId: WAITER_ID, permissions });

describe('POST /api/orders/:orderId/discount: permiso', () => {
  it('Esc. 2: un WAITER sin discount:apply recibe 403 FORBIDDEN', async () => {
    const res = await post(waiter(), { discountAmount: 5000 });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(applyDiscount).not.toHaveBeenCalled();
  });

  it('un WAITER con discount:apply llega al servicio (que valida la mesa)', async () => {
    const res = await post(waiter(['discount:apply']), { discountAmount: 5000 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(BILL);
    expect(applyDiscount).toHaveBeenCalledWith(
      ORDER_ID,
      { discountAmount: 5000 },
      expect.objectContaining({ userId: WAITER_ID, role: 'WAITER' }),
    );
  });

  it('el ADMIN puede sin el permiso en el token', async () => {
    expect((await post(tokenFor('ADMIN'), { discountAmount: 5000 })).status).toBe(200);
  });

  it('sin token 401 y COOK 403 (aunque traiga el permiso)', async () => {
    expect((await post(undefined, { discountAmount: 5000 })).status).toBe(401);
    expect(
      (await post(tokenFor('COOK', { permissions: ['discount:apply'] }), { discountAmount: 5000 }))
        .status,
    ).toBe(403);
    expect(applyDiscount).not.toHaveBeenCalled();
  });
});

describe('POST /api/orders/:orderId/discount: validacion', () => {
  it.each([
    ['decimal', { discountAmount: 1000.5 }],
    ['negativo', { discountAmount: -1 }],
    ['texto', { discountAmount: '5000' }],
    ['ausente', {}],
    ['total (R4)', { discountAmount: 1000, total: 0 }],
    ['appliedBy (R4)', { discountAmount: 1000, appliedBy: WAITER_ID }],
    ['appliedAt (R4)', { discountAmount: 1000, appliedAt: '2026-11-07T00:00:00Z' }],
    ['subtotal (R4)', { discountAmount: 1000, subtotal: 1000 }],
    ['motivo vacio', { discountAmount: 1000, reason: '   ' }],
    ['motivo de 256', { discountAmount: 1000, reason: 'x'.repeat(256) }],
  ])('%s responde 400', async (_label, body) => {
    const res = await post(tokenFor('ADMIN'), body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(applyDiscount).not.toHaveBeenCalled();
  });

  it('0 es valido (quita el descuento) y el motivo se recorta', async () => {
    await post(tokenFor('ADMIN'), { discountAmount: 0, reason: '  error de digitacion  ' });

    expect(applyDiscount).toHaveBeenCalledWith(
      ORDER_ID,
      { discountAmount: 0, reason: 'error de digitacion' },
      expect.anything(),
    );
  });

  it('orderId que no es UUID responde 400', async () => {
    const res = await call(app.base, 'POST', '/api/orders/no-uuid/discount', {
      token: tokenFor('ADMIN'),
      body: { discountAmount: 1 },
    });

    expect(res.status).toBe(400);
  });
});
