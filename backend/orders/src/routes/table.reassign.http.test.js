// PUT /api/orders/tables/:id/reassign con la app real: autenticacion, roles y validacion.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { reassignTable } from '../services/reassignTable.service.js';
import { call, startApp, tokenFor } from '../test/helpers.js';

vi.mock('../config/prisma.js', () => ({ prisma: {} }));
vi.mock('../services/reassignTable.service.js', () => ({ reassignTable: vi.fn() }));

const TABLE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WAITER_ID = '22222222-2222-4222-8222-222222222222';
const URL = `/api/orders/tables/${TABLE_ID}/reassign`;

let app;

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  reassignTable.mockResolvedValue({ orderId: 'o1', waiterId: WAITER_ID });
});

const put = (body, token = tokenFor('ADMIN'), path = URL) =>
  call(app.base, 'PUT', path, { token, body });

describe('PUT /api/orders/tables/:id/reassign', () => {
  it('el ADMIN reasigna y recibe 200', async () => {
    const res = await put({ waiterId: WAITER_ID });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ orderId: 'o1', waiterId: WAITER_ID });
    expect(reassignTable).toHaveBeenCalledWith(
      TABLE_ID,
      WAITER_ID,
      expect.objectContaining({ role: 'ADMIN' }),
    );
  });

  it('sin token responde 401', async () => {
    const res = await call(app.base, 'PUT', URL, { body: { waiterId: WAITER_ID } });

    expect(res.status).toBe(401);
    expect(reassignTable).not.toHaveBeenCalled();
  });

  it.each(['WAITER', 'COOK'])('%s responde 403', async (role) => {
    const res = await put({ waiterId: WAITER_ID }, tokenFor(role));

    expect(res.status).toBe(403);
    expect(reassignTable).not.toHaveBeenCalled();
  });

  it.each([
    ['waiterId que no es UUID', { waiterId: 'no-es-uuid' }],
    ['sin waiterId', {}],
    ['campos extra (R4)', { waiterId: WAITER_ID, openedBy: WAITER_ID }],
  ])('%s responde 400', async (_label, body) => {
    const res = await put(body);

    expect(res.status).toBe(400);
    expect(reassignTable).not.toHaveBeenCalled();
  });

  it('un id de mesa que no es UUID responde 400', async () => {
    const res = await put(
      { waiterId: WAITER_ID },
      tokenFor('ADMIN'),
      '/api/orders/tables/no-es-uuid/reassign',
    );

    expect(res.status).toBe(400);
  });
});
