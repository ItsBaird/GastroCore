// POST /api/orders/:orderId/close con la app real: solo ADMIN, sin cuerpo; las reglas van en el servicio.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeOrder } from '../services/closeOrder.service.js';
import { call, startApp, tokenFor } from '../test/helpers.js';

vi.mock('../config/prisma.js', () => ({ prisma: {} }));
vi.mock('../services/closeOrder.service.js', () => ({ closeOrder: vi.fn() }));

const ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const URL = `/api/orders/${ORDER_ID}/close`;
const RESULT = {
  orderId: ORDER_ID,
  tableNumber: 4,
  status: 'CERRADA',
  closedAt: '2026-11-26T20:00:00.000Z',
  rejectedQrRequests: 0,
  attendedServiceCalls: 0,
};

let app;
beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  closeOrder.mockResolvedValue(RESULT);
});

const post = (token, body) => call(app.base, 'POST', URL, { token, body });

describe('POST /api/orders/:orderId/close', () => {
  it('el ADMIN cierra la mesa: 200 con el resultado', async () => {
    const res = await post(tokenFor('ADMIN'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual(RESULT);
    expect(closeOrder).toHaveBeenCalledWith(ORDER_ID, expect.objectContaining({ role: 'ADMIN' }));
  });

  it.each(['WAITER', 'COOK'])('%s: 403 sin llegar al servicio', async (role) => {
    const res = await post(tokenFor(role));

    expect(res.status).toBe(403);
    expect(closeOrder).not.toHaveBeenCalled();
  });

  it('sin token: 401', async () => {
    expect((await post()).status).toBe(401);
  });

  it('con cuerpo: 400 (no recibe nada)', async () => {
    const res = await post(tokenFor('ADMIN'), { force: true });

    expect(res.status).toBe(400);
    expect(closeOrder).not.toHaveBeenCalled();
  });

  it('orderId que no es UUID: 400', async () => {
    const res = await call(app.base, 'POST', '/api/orders/no-es-uuid/close', {
      token: tokenFor('ADMIN'),
    });

    expect(res.status).toBe(400);
  });
});
