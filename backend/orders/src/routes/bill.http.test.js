// GET /api/orders/:orderId/bill con la app real: autenticacion, roles y validacion (R4).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBill } from '../services/bill.service.js';
import { call, startApp, tokenFor } from '../test/helpers.js';

vi.mock('../config/prisma.js', () => ({ prisma: {} }));
vi.mock('../services/bill.service.js', () => ({ getBill: vi.fn() }));

const ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const WAITER_ID = '22222222-2222-4222-8222-222222222222';
const URL = `/api/orders/${ORDER_ID}/bill`;
const BILL = {
  orderId: ORDER_ID,
  tableNumber: 7,
  status: 'EN_COBRO',
  items: [],
  subtotal: 0,
  discountAmount: 0,
  total: 0,
};

let app;

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  getBill.mockResolvedValue(BILL);
});

const get = (token, path = URL) => call(app.base, 'GET', path, { token });

describe('GET /api/orders/:orderId/bill', () => {
  it.each(['WAITER', 'ADMIN'])('%s recibe 200 con la cuenta', async (role) => {
    const res = await get(tokenFor(role, { userId: WAITER_ID }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual(BILL);
    expect(getBill).toHaveBeenCalledWith(
      ORDER_ID,
      expect.objectContaining({ userId: WAITER_ID, role }),
    );
  });

  it('sin token responde 401', async () => {
    expect((await get(undefined)).status).toBe(401);
    expect(getBill).not.toHaveBeenCalled();
  });

  it('COOK responde 403', async () => {
    expect((await get(tokenFor('COOK'))).status).toBe(403);
    expect(getBill).not.toHaveBeenCalled();
  });

  it.each(['total=1', 'subtotal=5000', 'discountAmount=0'])(
    'un parametro de consulta (%s) responde 400 (R4)',
    async (qs) => {
      const res = await get(tokenFor('WAITER'), `${URL}?${qs}`);

      expect(res.status).toBe(400);
      expect(getBill).not.toHaveBeenCalled();
    },
  );

  it('orderId que no es UUID responde 400', async () => {
    expect((await get(tokenFor('WAITER'), '/api/orders/no-uuid/bill')).status).toBe(400);
  });
});
