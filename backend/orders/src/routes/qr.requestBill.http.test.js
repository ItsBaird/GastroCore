// Pedir la cuenta desde el QR (GC-QR-0004, GC-146 y GC-147) con la app real (rutas, errores, Socket.io simulado).
// Solo la base de datos va simulada: el repositorio. El io se reemplaza por uno que registra lo emitido.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServiceCall, findTableByQrToken } from '../repositories/serviceCall.repository.js';
import { call, startApp } from '../test/helpers.js';

const hoisted = vi.hoisted(() => {
  const emitted = [];
  const state = { ioFails: false };
  const io = {
    to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }),
  };
  return { emitted, state, io };
});

// Evita que los repositorios de las demas rutas construyan un PrismaClient real al cargar la app
vi.mock('../config/prisma.js', () => ({ prisma: {} }));
vi.mock('../repositories/serviceCall.repository.js', () => ({
  findTableByQrToken: vi.fn(),
  createServiceCall: vi.fn(),
}));
vi.mock('../realtime/events.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getIo: () => {
    if (hoisted.state.ioFails) throw new Error('Socket.io no inicializado');
    return hoisted.io;
  },
}));

const TABLE_ID = '33333333-3333-4333-8333-333333333333';
const WAITER_ID = '44444444-4444-4444-8444-444444444444';
const CALL_ID = '55555555-5555-4555-8555-555555555555';
const TOKEN = 'Zm9vYmFyYmF6cXV4c29tZXRva2VuMTIzNDU2Nzg5MDEyMw'; // forma de un qrToken (base64url)
const URL = (token = TOKEN) => `/api/orders/qr/${token}/request-bill`;

const tableWith = (orders) => ({ tableId: TABLE_ID, tableNumber: 4, orders });
const BUSY = tableWith([{ orderId: 'o-1', waiterId: WAITER_ID, status: 'ABIERTA' }]);
const BILLING = tableWith([{ orderId: 'o-1', waiterId: WAITER_ID, status: 'EN_COBRO' }]);
const FREE = tableWith([]);
const prismaCode = (code) => Object.assign(new Error('x'), { code });

let app;
beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  hoisted.emitted.length = 0;
  hoisted.state.ioFails = false;
  findTableByQrToken.mockResolvedValue(BUSY);
  createServiceCall.mockImplementation(async ({ tableId, type }) => ({
    serviceCallId: CALL_ID,
    tableId,
    type,
    status: 'pendiente',
    createdAt: new Date('2026-11-14T15:00:00Z'),
    attendedAt: null,
    attendedBy: null,
  }));
});

describe('pedir la cuenta con la mesa ocupada (criterio 1)', () => {
  it('es publico: crea un service_call request_bill pendiente sin sesion -> 201 PublicServiceCall', async () => {
    const res = await call(app.base, 'POST', URL());
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      serviceCallId: CALL_ID,
      type: 'request_bill',
      status: 'pendiente',
      createdAt: '2026-11-14T15:00:00.000Z',
    });
    expect(res.body).not.toHaveProperty('tableId');
    expect(findTableByQrToken).toHaveBeenCalledWith(TOKEN);
    expect(createServiceCall).toHaveBeenCalledWith({ tableId: TABLE_ID, type: 'request_bill' });
  });

  it('emite bill:requested SOLO a waiter:{id} del mesero asignado, nunca a "waiters" ni a cocina', async () => {
    await call(app.base, 'POST', URL());
    expect(hoisted.emitted).toHaveLength(1);
    expect(hoisted.emitted[0]).toMatchObject({
      room: `waiter:${WAITER_ID}`,
      event: 'bill:requested',
      payload: {
        serviceCallId: CALL_ID,
        tableId: TABLE_ID,
        tableNumber: 4,
        type: 'request_bill',
        status: 'pendiente',
      },
    });
    expect(hoisted.emitted.map((e) => e.room)).not.toContain('waiters');
    expect(hoisted.emitted.map((e) => e.room)).not.toContain('kitchen');
  });

  it('el payload del evento tiene la forma de waiter:called (ServiceCall + tableNumber)', async () => {
    await call(app.base, 'POST', URL());
    expect(Object.keys(hoisted.emitted[0].payload).sort()).toEqual([
      'attendedAt',
      'attendedBy',
      'createdAt',
      'serviceCallId',
      'status',
      'tableId',
      'tableNumber',
      'type',
    ]);
  });

  it('el cliente no elige mesa ni tipo: el cuerpo se ignora', async () => {
    const res = await call(app.base, 'POST', URL(), {
      body: { tableId: 'otra', type: 'call_waiter', status: 'atendido' },
    });
    expect(res.status).toBe(201);
    expect(createServiceCall).toHaveBeenCalledWith({ tableId: TABLE_ID, type: 'request_bill' });
  });
});

describe('cuando no se puede pedir la cuenta', () => {
  it('mesa libre -> 409 TABLE_NOT_OPEN, sin crear ni emitir', async () => {
    findTableByQrToken.mockResolvedValue(FREE);
    const res = await call(app.base, 'POST', URL());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TABLE_NOT_OPEN');
    expect(createServiceCall).not.toHaveBeenCalled();
    expect(hoisted.emitted).toEqual([]);
  });

  it('mesa en cobro -> 409 INVALID_TRANSITION, sin crear ni emitir', async () => {
    findTableByQrToken.mockResolvedValue(BILLING);
    const res = await call(app.base, 'POST', URL());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
    expect(createServiceCall).not.toHaveBeenCalled();
    expect(hoisted.emitted).toEqual([]);
  });

  it('ya hay una peticion pendiente -> 409 CONFLICT con details.type y sin un segundo aviso', async () => {
    createServiceCall.mockRejectedValue(prismaCode('P2002'));
    const res = await call(app.base, 'POST', URL());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.details).toEqual({ type: 'request_bill' });
    expect(hoisted.emitted).toEqual([]);
  });

  it('dos pulsaciones simultaneas: una crea (201) y la otra choca con el indice unico (409)', async () => {
    let first = true;
    createServiceCall.mockImplementation(async ({ tableId, type }) => {
      if (!first) throw prismaCode('P2002');
      first = false;
      return {
        serviceCallId: CALL_ID,
        tableId,
        type,
        status: 'pendiente',
        createdAt: new Date('2026-11-14T15:00:00Z'),
        attendedAt: null,
        attendedBy: null,
      };
    });
    const results = await Promise.all([
      call(app.base, 'POST', URL()),
      call(app.base, 'POST', URL()),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(hoisted.emitted).toHaveLength(1);
  });

  it('token desconocido o malformado -> 404 sin pistas', async () => {
    findTableByQrToken.mockResolvedValue(null);
    expect((await call(app.base, 'POST', URL('desconocido'))).status).toBe(404);
    expect((await call(app.base, 'POST', URL('a'.repeat(300)))).status).toBe(404);
    expect(createServiceCall).not.toHaveBeenCalled();
    expect(hoisted.emitted).toEqual([]);
  });

  it('la mesa se borro entre la consulta y el alta (P2003) -> 404', async () => {
    createServiceCall.mockRejectedValue(prismaCode('P2003'));
    expect((await call(app.base, 'POST', URL())).status).toBe(404);
  });
});

describe('robustez', () => {
  it('si Socket.io falla, el llamado ya guardado se responde igual con 201', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    hoisted.state.ioFails = true;
    const res = await call(app.base, 'POST', URL());
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('request_bill');
    spy.mockRestore();
  });

  it('un error inesperado de la base -> 500 sin filtrar detalles', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    createServiceCall.mockRejectedValue(new Error('password=secreto'));
    const res = await call(app.base, 'POST', URL());
    expect(res.status).toBe(500);
    expect(res.text).not.toContain('secreto');
    spy.mockRestore();
  });

  it('solo POST: un GET a la ruta no existe', async () => {
    expect((await call(app.base, 'GET', URL())).status).toBe(404);
  });
});
