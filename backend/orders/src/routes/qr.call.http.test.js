// Llamar al mesero desde el QR (GC-QR-0002) con la app real (rutas, errores, Socket.io simulado).
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
const TOKEN = 'Zm9vYmFyYmF6cXV4c29tZXRva2VuMTIzNDU2Nzg5MDEyMw'; // forma de un qrToken (base64url)
const URL = (token = TOKEN) => `/api/orders/qr/${token}/call`;

const FREE_TABLE = { tableId: TABLE_ID, tableNumber: 4, orders: [] };
const BUSY_TABLE = { tableId: TABLE_ID, tableNumber: 4, orders: [{ waiterId: WAITER_ID }] };
const p2002 = () => Object.assign(new Error('Unique constraint'), { code: 'P2002' });
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
  findTableByQrToken.mockResolvedValue(FREE_TABLE);
  createServiceCall.mockImplementation(async ({ tableId, type }) => ({
    serviceCallId: '55555555-5555-4555-8555-555555555555',
    tableId,
    type,
    status: 'pendiente',
    createdAt: new Date('2026-11-08T15:00:00Z'),
    attendedAt: null,
    attendedBy: null,
  }));
});

describe('llamado con la mesa libre', () => {
  it('es publico: crea el service_call "call_waiter" sin token de sesion -> 201', async () => {
    const res = await call(app.base, 'POST', URL());
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      serviceCallId: '55555555-5555-4555-8555-555555555555',
      tableId: TABLE_ID,
      type: 'call_waiter',
      status: 'pendiente',
      createdAt: '2026-11-08T15:00:00.000Z',
      attendedAt: null,
      attendedBy: null,
    });
    expect(findTableByQrToken).toHaveBeenCalledWith(TOKEN);
    expect(createServiceCall).toHaveBeenCalledWith({ tableId: TABLE_ID, type: 'call_waiter' });
  });

  it('emite waiter:called a la sala "waiters" (todos los meseros) con el llamado y el numero de mesa', async () => {
    await call(app.base, 'POST', URL());
    expect(hoisted.emitted).toHaveLength(1);
    expect(hoisted.emitted[0]).toMatchObject({
      room: 'waiters',
      event: 'waiter:called',
      payload: {
        serviceCallId: '55555555-5555-4555-8555-555555555555',
        tableId: TABLE_ID,
        tableNumber: 4,
        type: 'call_waiter',
        status: 'pendiente',
      },
    });
  });

  it('el cliente no puede elegir la mesa ni el tipo: el cuerpo se ignora', async () => {
    const res = await call(app.base, 'POST', URL(), {
      body: { tableId: 'otra', type: 'request_bill', status: 'atendido' },
    });
    expect(res.status).toBe(201);
    expect(createServiceCall).toHaveBeenCalledWith({ tableId: TABLE_ID, type: 'call_waiter' });
  });

  it('una cabecera Authorization cualquiera no importa (no hay sesion en este canal)', async () => {
    const res = await fetch(app.base + URL(), {
      method: 'POST',
      headers: { Authorization: 'Bearer basura' },
    });
    expect(res.status).toBe(201);
  });
});

describe('llamado con la mesa ocupada o en cobro', () => {
  it('emite solo a la sala del mesero asignado (waiter:{id}), no a toda la sala waiters', async () => {
    findTableByQrToken.mockResolvedValue(BUSY_TABLE);
    const res = await call(app.base, 'POST', URL());
    expect(res.status).toBe(201);
    expect(hoisted.emitted).toHaveLength(1);
    expect(hoisted.emitted[0].room).toBe(`waiter:${WAITER_ID}`);
    expect(hoisted.emitted[0].event).toBe('waiter:called');
    expect(hoisted.emitted[0].payload.tableNumber).toBe(4);
  });
});

describe('llamado duplicado pendiente', () => {
  it('si ya hay uno pendiente del mismo tipo -> 409 CONFLICT y no se avisa a nadie', async () => {
    createServiceCall.mockRejectedValue(p2002());
    const res = await call(app.base, 'POST', URL());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.message).toMatch(/llamado pendiente/);
    expect(res.body.error.details).toEqual({ type: 'call_waiter' });
    expect(hoisted.emitted).toEqual([]);
  });

  it('dos pulsaciones simultaneas (indice unico de la base): una crea y la otra recibe 409', async () => {
    let pending = false; // imita uix_service_calls_one_pending
    createServiceCall.mockImplementation(async ({ tableId, type }) => {
      if (pending) throw p2002();
      pending = true;
      return {
        serviceCallId: '55555555-5555-4555-8555-555555555555',
        tableId,
        type,
        status: 'pendiente',
        createdAt: new Date(),
        attendedAt: null,
        attendedBy: null,
      };
    });
    const results = await Promise.all([
      call(app.base, 'POST', URL()),
      call(app.base, 'POST', URL()),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(hoisted.emitted).toHaveLength(1); // solo el llamado creado avisa
  });
});

describe('token del QR invalido', () => {
  it('token que no existe -> 404 NOT_FOUND y no se crea nada', async () => {
    findTableByQrToken.mockResolvedValue(null);
    const res = await call(app.base, 'POST', URL('token-que-no-existe'));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(createServiceCall).not.toHaveBeenCalled();
    expect(hoisted.emitted).toEqual([]);
  });

  it('token mas largo que la columna (255) -> 404 sin consultar la base', async () => {
    const res = await call(app.base, 'POST', URL('a'.repeat(256)));
    expect(res.status).toBe(404);
    expect(findTableByQrToken).not.toHaveBeenCalled();
  });

  it('caracteres raros en el token se tratan como un token mas (consulta parametrizada) -> 404', async () => {
    findTableByQrToken.mockResolvedValue(null);
    const res = await call(app.base, 'POST', URL(encodeURIComponent("' OR 1=1 --")));
    expect(res.status).toBe(404);
    expect(findTableByQrToken).toHaveBeenCalledWith("' OR 1=1 --");
  });

  it('la mesa se borra justo entre la consulta y el alta (FK, P2003) -> 404', async () => {
    createServiceCall.mockRejectedValue(prismaCode('P2003'));
    const res = await call(app.base, 'POST', URL());
    expect(res.status).toBe(404);
  });
});

describe('fallos', () => {
  it('si falla el aviso en tiempo real, el llamado ya esta guardado: sigue siendo 201', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    hoisted.state.ioFails = true;
    const res = await call(app.base, 'POST', URL());
    expect(res.status).toBe(201);
    expect(createServiceCall).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it('error inesperado de la base -> 500 sin filtrar detalles y sin avisar', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    createServiceCall.mockRejectedValue(new Error('password=secreto'));
    const res = await call(app.base, 'POST', URL());
    expect(res.status).toBe(500);
    expect(res.text).not.toContain('secreto');
    expect(hoisted.emitted).toEqual([]);
    spy.mockRestore();
  });
});

describe('rutas', () => {
  it('solo existe POST: un GET a la misma ruta no la ejecuta', async () => {
    const res = await call(app.base, 'GET', URL());
    expect(res.status).toBe(404);
    expect(createServiceCall).not.toHaveBeenCalled();
  });

  it('una ruta parecida sin /call no la captura otra ruta de ordenes', async () => {
    const res = await call(app.base, 'POST', `/api/orders/qr/${TOKEN}`);
    expect(res.status).toBe(404);
    expect(createServiceCall).not.toHaveBeenCalled();
  });
});
