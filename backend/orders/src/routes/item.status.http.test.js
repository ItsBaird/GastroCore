// PUT /api/orders/items/:id/status con la app real: autenticacion, roles y validacion.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { staffClient } from '../clients/staffClient.js';
import { updateItemStatus } from '../services/itemStatus.service.js';
import { call, startApp, tokenFor } from '../test/helpers.js';

vi.mock('../config/prisma.js', () => ({ prisma: {} }));
vi.mock('../services/itemStatus.service.js', () => ({ updateItemStatus: vi.fn() }));
vi.mock('../clients/staffClient.js', () => ({ staffClient: { hasActiveShift: vi.fn() } }));

const ITEM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const URL = `/api/orders/items/${ITEM_ID}/status`;

let app;

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  updateItemStatus.mockResolvedValue({ itemId: ITEM_ID, status: 'en_preparacion' });
  staffClient.hasActiveShift.mockResolvedValue(true);
});

const put = (body, token = tokenFor('COOK'), path = URL) =>
  call(app.base, 'PUT', path, { token, body });

describe('PUT /api/orders/items/:id/status', () => {
  it.each(['COOK', 'ADMIN'])('%s avanza el item y recibe 200', async (role) => {
    const res = await put({ status: 'en_preparacion' }, tokenFor(role));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ itemId: ITEM_ID, status: 'en_preparacion' });
    expect(updateItemStatus).toHaveBeenCalledWith(ITEM_ID, 'en_preparacion');
  });

  it('un estado real no permitido llega al servicio, que decide el 409', async () => {
    const res = await put({ status: 'entregado' });

    expect(res.status).toBe(200);
    expect(updateItemStatus).toHaveBeenCalledWith(ITEM_ID, 'entregado');
  });

  it('sin token responde 401', async () => {
    const res = await call(app.base, 'PUT', URL, { body: { status: 'listo' } });

    expect(res.status).toBe(401);
    expect(updateItemStatus).not.toHaveBeenCalled();
  });

  it('WAITER responde 403', async () => {
    const res = await put({ status: 'listo' }, tokenFor('WAITER'));

    expect(res.status).toBe(403);
    expect(updateItemStatus).not.toHaveBeenCalled();
  });

  it.each([
    ['estado inventado', { status: 'quemado' }],
    ['sin estado', {}],
    ['campos extra (R4)', { status: 'listo', readyAt: '2026-11-07T15:00:00Z' }],
  ])('%s responde 400', async (_label, body) => {
    const res = await put(body);

    expect(res.status).toBe(400);
    expect(updateItemStatus).not.toHaveBeenCalled();
  });

  it('id que no es UUID responde 400', async () => {
    const res = await put(
      { status: 'listo' },
      tokenFor('COOK'),
      '/api/orders/items/no-uuid/status',
    );

    expect(res.status).toBe(400);
    expect(updateItemStatus).not.toHaveBeenCalled();
  });
});

describe('PUT /api/orders/items/:id/status y el turno del COOK', () => {
  const COOK_ID = '33333333-3333-4333-8333-333333333333';

  it('COOK sin turno activo: 409 NO_ACTIVE_SHIFT antes de mirar el item', async () => {
    staffClient.hasActiveShift.mockResolvedValue(false);
    const res = await put({ status: 'en_preparacion' }, tokenFor('COOK', { userId: COOK_ID }));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_ACTIVE_SHIFT');
    expect(staffClient.hasActiveShift).toHaveBeenCalledWith(COOK_ID);
    expect(updateItemStatus).not.toHaveBeenCalled();
  });

  it('ADMIN no necesita turno', async () => {
    staffClient.hasActiveShift.mockResolvedValue(false);
    const res = await put({ status: 'en_preparacion' }, tokenFor('ADMIN'));

    expect(res.status).toBe(200);
    expect(staffClient.hasActiveShift).not.toHaveBeenCalled();
  });

  it('WAITER sigue recibiendo 403 sin consultar Staff', async () => {
    const res = await put({ status: 'listo' }, tokenFor('WAITER'));

    expect(res.status).toBe(403);
    expect(staffClient.hasActiveShift).not.toHaveBeenCalled();
  });
});
