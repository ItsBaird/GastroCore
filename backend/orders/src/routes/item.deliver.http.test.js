// PUT /api/orders/items/:id/deliver con la app real: autenticacion, roles y validacion (R4).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deliverItem } from '../services/deliverItem.service.js';
import { ADMIN_ID, call, startApp, tokenFor } from '../test/helpers.js';

vi.mock('../config/prisma.js', () => ({ prisma: {} }));
vi.mock('../services/deliverItem.service.js', () => ({ deliverItem: vi.fn() }));

const ITEM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WAITER_ID = '22222222-2222-4222-8222-222222222222';
const URL = `/api/orders/items/${ITEM_ID}/deliver`;

let app;

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  deliverItem.mockResolvedValue({ itemId: ITEM_ID, status: 'entregado' });
});

const put = (token, { body, path = URL } = {}) => call(app.base, 'PUT', path, { token, body });

describe('PUT /api/orders/items/:id/deliver', () => {
  it('WAITER sin cuerpo recibe 200 y el servicio recibe su usuario', async () => {
    const res = await put(tokenFor('WAITER', { userId: WAITER_ID }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ itemId: ITEM_ID, status: 'entregado' });
    expect(deliverItem).toHaveBeenCalledWith(
      ITEM_ID,
      expect.objectContaining({ userId: WAITER_ID, role: 'WAITER' }),
    );
  });

  it('ADMIN con cuerpo vacio {} recibe 200', async () => {
    const res = await put(tokenFor('ADMIN'), { body: {} });

    expect(res.status).toBe(200);
    expect(deliverItem).toHaveBeenCalledWith(
      ITEM_ID,
      expect.objectContaining({ userId: ADMIN_ID }),
    );
  });

  it('sin token responde 401', async () => {
    const res = await put(undefined);

    expect(res.status).toBe(401);
    expect(deliverItem).not.toHaveBeenCalled();
  });

  it('COOK responde 403', async () => {
    const res = await put(tokenFor('COOK'));

    expect(res.status).toBe(403);
    expect(deliverItem).not.toHaveBeenCalled();
  });

  it.each([
    ['estado', { status: 'entregado' }],
    ['fecha de entrega', { deliveredAt: '2026-11-07T18:00:00Z' }],
  ])('un cuerpo con %s responde 400 (R4)', async (_label, body) => {
    const res = await put(tokenFor('WAITER'), { body });

    expect(res.status).toBe(400);
    expect(deliverItem).not.toHaveBeenCalled();
  });

  it('id que no es UUID responde 400', async () => {
    const res = await put(tokenFor('WAITER'), { path: '/api/orders/items/no-uuid/deliver' });

    expect(res.status).toBe(400);
    expect(deliverItem).not.toHaveBeenCalled();
  });

  it('los errores del servicio llegan con el formato del contrato', async () => {
    const { AppError } = await import('../errors/AppError.js');
    deliverItem.mockRejectedValue(
      new AppError({
        status: 409,
        code: 'INVALID_TRANSITION',
        message: 'Solo se entregan ítems listos',
      }),
    );

    const res = await put(tokenFor('WAITER'));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });
});
