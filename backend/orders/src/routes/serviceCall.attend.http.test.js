// Atender un llamado con la app real (rutas, JWT, validacion, errores). Se simulan el repositorio, el estado
// de mesas y los eventos: no hace falta base de datos ni Socket.io.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { call, startApp, tokenFor } from '../test/helpers.js';

vi.mock('../config/prisma.js', () => ({ prisma: {} }));
vi.mock('../repositories/serviceCall.repository.js');
vi.mock('../realtime/events.js');
vi.mock('../services/tableStatus.service.js');

const repo = await import('../repositories/serviceCall.repository.js');
const events = await import('../realtime/events.js');
const { getTableStatus } = await import('../services/tableStatus.service.js');

const CALL_ID = '88888888-8888-4888-8888-888888888888';
const TABLE_ID = '33333333-3333-4333-8333-333333333333';
const WAITER_ID = '55555555-5555-4555-8555-555555555555';
const URL = `/api/orders/service-calls/${CALL_ID}/attend`;

const pending = (over = {}) => ({
  serviceCallId: CALL_ID,
  tableId: TABLE_ID,
  type: 'call_waiter',
  status: 'pendiente',
  createdAt: new Date('2026-11-10T10:00:00Z'),
  attendedAt: null,
  attendedBy: null,
  table: { tableId: TABLE_ID, orders: [{ waiterId: WAITER_ID }] },
  ...over,
});

let app;
const as = (role, userId = WAITER_ID) => tokenFor(role, { userId });
const put = (path, token, body) => call(app.base, 'PUT', path, { token, body });

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  repo.findServiceCallForAttend.mockResolvedValue(pending());
  repo.markServiceCallAttended.mockResolvedValue({
    serviceCallId: CALL_ID,
    tableId: TABLE_ID,
    type: 'call_waiter',
    status: 'atendido',
    createdAt: new Date('2026-11-10T10:00:00Z'),
    attendedAt: new Date('2026-11-10T10:02:00Z'),
    attendedBy: WAITER_ID,
  });
  getTableStatus.mockResolvedValue({ tableId: TABLE_ID, pendingCalls: [] });
});

describe('PUT /service-calls/:id/attend', () => {
  it('200 con el ServiceCall atendido y avisa al panel de mesas', async () => {
    const res = await put(URL, as('WAITER'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      serviceCallId: CALL_ID,
      tableId: TABLE_ID,
      type: 'call_waiter',
      status: 'atendido',
      createdAt: '2026-11-10T10:00:00.000Z',
      attendedAt: '2026-11-10T10:02:00.000Z',
      attendedBy: WAITER_ID,
    });
    expect(events.emitTableStatusChanged).toHaveBeenCalledWith({
      tableId: TABLE_ID,
      pendingCalls: [],
    });
  });

  it('sin sesion -> 401', async () => {
    const res = await put(URL, undefined);
    expect(res.status).toBe(401);
    expect(repo.findServiceCallForAttend).not.toHaveBeenCalled();
  });

  it('el cocinero -> 403', async () => {
    const res = await put(URL, as('COOK'));
    expect(res.status).toBe(403);
    expect(repo.findServiceCallForAttend).not.toHaveBeenCalled();
  });

  it('otro mesero con la mesa ocupada -> 403', async () => {
    const res = await put(URL, as('WAITER', '99999999-9999-4999-8999-999999999999'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(repo.markServiceCallAttended).not.toHaveBeenCalled();
  });

  it('el ADMIN puede', async () => {
    const res = await put(URL, as('ADMIN', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
    expect(res.status).toBe(200);
  });

  it('mesa libre: cualquier mesero puede', async () => {
    repo.findServiceCallForAttend.mockResolvedValue(
      pending({ table: { tableId: TABLE_ID, orders: [] } }),
    );
    const res = await put(URL, as('WAITER', '99999999-9999-4999-8999-999999999999'));
    expect(res.status).toBe(200);
  });

  it('el id debe ser UUID -> 400', async () => {
    const res = await put(URL.replace(CALL_ID, 'no-es-uuid'), as('WAITER'));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('inexistente -> 404', async () => {
    repo.findServiceCallForAttend.mockResolvedValue(null);
    const res = await put(URL, as('WAITER'));
    expect(res.status).toBe(404);
  });

  it('ya atendido -> 409 INVALID_TRANSITION', async () => {
    repo.findServiceCallForAttend.mockResolvedValue(pending({ status: 'atendido' }));
    const res = await put(URL, as('WAITER'));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('carrera: lo cerro otro entre la lectura y la escritura -> 409', async () => {
    repo.markServiceCallAttended.mockResolvedValue(null);
    const res = await put(URL, as('WAITER'));
    expect(res.status).toBe(409);
  });

  it('un cuerpo con campos -> 400 sin tocar nada', async () => {
    const res = await put(URL, as('WAITER'), { status: 'atendido' });
    expect(res.status).toBe(400);
    expect(repo.markServiceCallAttended).not.toHaveBeenCalled();
  });

  it('solo PUT: un GET a la ruta no existe', async () => {
    const res = await call(app.base, 'GET', URL, { token: as('WAITER') });
    expect(res.status).toBe(404);
  });
});
