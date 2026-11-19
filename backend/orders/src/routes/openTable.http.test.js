// POST /tables/:id/open con la app real: comprueba que el rol del token llega al servicio.
// Repositorio, Staff y eventos van simulados.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { staffClient } from '../clients/staffClient.js';
import { createOrder, findOpenOrderByTable, findTableById } from '../repositories/openTable.repository.js';
import { ADMIN_ID, call, startApp, tokenFor } from '../test/helpers.js';

vi.mock('../config/prisma.js', () => ({ prisma: {} }));
vi.mock('../repositories/openTable.repository.js', () => ({
  createOrder: vi.fn(),
  findOpenOrderByTable: vi.fn(),
  findTableById: vi.fn(),
}));
vi.mock('../clients/staffClient.js', () => ({ staffClient: { hasActiveShift: vi.fn() } }));
vi.mock('../realtime/events.js', () => ({ emitTableStatusChanged: vi.fn() }));
vi.mock('../services/tableStatus.service.js', () => ({ getTableStatus: vi.fn() }));

const TABLE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WAITER_ID = '22222222-2222-4222-8222-222222222222';
const PATH = `/api/orders/tables/${TABLE_ID}/open`;

let app;

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  findTableById.mockResolvedValue({ tableId: TABLE_ID, tableNumber: 4 });
  findOpenOrderByTable.mockResolvedValue(null);
  staffClient.hasActiveShift.mockResolvedValue(false);
  createOrder.mockImplementation(async ({ tableId, openedBy, waiterId }) => ({
    orderId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    tableId,
    openedBy,
    waiterId,
    status: 'ABIERTA',
  }));
});

describe('POST /tables/:id/open y el turno', () => {
  it('ADMIN sin turno abre la mesa y queda como responsable', async () => {
    const res = await call(app.base, 'POST', PATH, { token: tokenFor('ADMIN') });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ openedBy: ADMIN_ID, waiterId: ADMIN_ID, status: 'ABIERTA' });
    expect(staffClient.hasActiveShift).not.toHaveBeenCalled();
  });

  it('WAITER sin turno sigue recibiendo 409 NO_ACTIVE_SHIFT', async () => {
    const token = tokenFor('WAITER', { userId: WAITER_ID });
    const res = await call(app.base, 'POST', PATH, { token });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_ACTIVE_SHIFT');
    expect(staffClient.hasActiveShift).toHaveBeenCalledWith(WAITER_ID);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('WAITER con turno abre la mesa', async () => {
    staffClient.hasActiveShift.mockResolvedValue(true);
    const token = tokenFor('WAITER', { userId: WAITER_ID });
    const res = await call(app.base, 'POST', PATH, { token });

    expect(res.status).toBe(201);
    expect(res.body.waiterId).toBe(WAITER_ID);
  });

  it('COOK no puede abrir mesas', async () => {
    const res = await call(app.base, 'POST', PATH, { token: tokenFor('COOK') });

    expect(res.status).toBe(403);
    expect(createOrder).not.toHaveBeenCalled();
  });
});
