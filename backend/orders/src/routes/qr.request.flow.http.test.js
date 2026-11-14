// GC-145. Flujo completo de la solicitud de pedido por QR (HU GC-QR-0003), de punta a punta y con ESTADO: lo que
// una peticion deja guardado lo ve la siguiente. Usa la aplicacion real (rutas, JWT, validacion, servicios,
// eventos y mapeos); solo se simulan los bordes: la base (un repositorio en memoria), el catalogo y el io.
// Cada pieza ya tiene su prueba aislada (qr.request, qrRequest.resolve, qrRequest.list, requestOrder.service...);
// aqui se comprueba que, encadenadas, cumplen los cuatro criterios de aceptacion:
//   1. Solicitud enviada      2. Mesa no abierta      3. Confirmacion del mesero      4. Rechazo del mesero
// Lo que depende de PostgreSQL de verdad (candados, carreras, CHECK) no se puede probar aqui: se verifico
// contra la base real al implementarlo (ver el commit f4c16fe y d71a683).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setIo } from '../realtime/events.js';
import { call, startApp, tokenFor } from '../test/helpers.js';

const h = vi.hoisted(() => {
  const emitted = [];
  const db = { order: null, requests: [], rounds: [], seq: 0 };
  const catalog = new Map();
  const uuid = () => {
    db.seq += 1;
    return `00000000-0000-4000-8000-${String(db.seq).padStart(12, '0')}`;
  };
  const TABLE = { tableId: '33333333-3333-4333-8333-333333333333', tableNumber: 4 };
  const io = {
    to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }),
  };
  const orderView = (order) => ({
    orderId: order.orderId,
    tableId: TABLE.tableId,
    status: order.status,
    waiterId: order.waiterId,
    table: { tableNumber: TABLE.tableNumber },
  });
  const withItems = (r) => ({ ...r, items: r.items.map((i) => ({ ...i })) });
  const repo = {
    findTableByQrToken: async (token) =>
      token === 'TOKEN-4'
        ? {
            ...TABLE,
            orders: db.order
              ? [
                  {
                    orderId: db.order.orderId,
                    waiterId: db.order.waiterId,
                    status: db.order.status,
                  },
                ]
              : [],
          }
        : null,
    createServiceCall: async () => {
      throw new Error('no se usa en este flujo');
    },
    countPendingQrRequests: async (orderId) =>
      db.requests.filter((r) => r.orderId === orderId && r.status === 'pendiente').length,
    createQrRequestWithItems: async ({ orderId, items }) => {
      const row = {
        qrRequestId: uuid(),
        orderId,
        status: 'pendiente',
        createdAt: new Date(`2026-11-14T10:${String(db.requests.length).padStart(2, '0')}:00Z`),
        resolvedAt: null,
        resolvedBy: null,
        items: items.map(({ productId, quantity, note }) => ({
          productId,
          quantity,
          note: note ?? null,
        })),
      };
      db.requests.push(row);
      return withItems(row);
    },
    findPendingQrRequests: async ({ waiterId } = {}) =>
      db.requests
        .filter(
          (r) =>
            r.status === 'pendiente' &&
            db.order.status !== 'CERRADA' &&
            (!waiterId || db.order.waiterId === waiterId),
        )
        .map((r) => ({ ...withItems(r), order: { table: { tableNumber: TABLE.tableNumber } } })),
    findQrRequestForResolution: async (id) => {
      const r = db.requests.find((x) => x.qrRequestId === id);
      return r ? { ...withItems(r), order: orderView(db.order) } : null;
    },
    markQrRequestRejected: async ({ qrRequestId, resolvedBy }) => {
      const r = db.requests.find((x) => x.qrRequestId === qrRequestId);
      if (!r || r.status !== 'pendiente') return null;
      Object.assign(r, { status: 'rechazada', resolvedBy, resolvedAt: new Date() });
      return withItems(r);
    },
    confirmQrRequestWithRound: async ({ qrRequestId, orderId, resolvedBy, items }) => {
      if (db.order.status !== 'ABIERTA') return 'ORDER_NOT_OPEN';
      const r = db.requests.find((x) => x.qrRequestId === qrRequestId);
      if (!r || r.status !== 'pendiente') return null;
      Object.assign(r, { status: 'confirmada', resolvedBy, resolvedAt: new Date() });
      const round = {
        roundId: uuid(),
        orderId,
        source: 'QR',
        qrRequestId,
        createdBy: resolvedBy,
        createdAt: new Date(),
        items: items.map((i) => ({
          itemId: uuid(),
          roundId: null,
          productId: i.productId,
          productNameSnapshot: i.productName,
          unitPriceSnapshot: i.unitPrice,
          quantity: i.quantity,
          note: i.note ?? null,
          status: 'pendiente',
        })),
      };
      round.items.forEach((i) => (i.roundId = round.roundId));
      db.rounds.push(round);
      return round;
    },
  };
  return { emitted, db, catalog, io, repo, TABLE };
});

vi.mock('../config/prisma.js', () => ({ prisma: {} }));
vi.mock('../repositories/serviceCall.repository.js', () => ({
  findTableByQrToken: (...a) => h.repo.findTableByQrToken(...a),
  createServiceCall: (...a) => h.repo.createServiceCall(...a),
}));
vi.mock('../repositories/qrRequest.repository.js', () => ({
  countPendingQrRequests: (...a) => h.repo.countPendingQrRequests(...a),
  createQrRequestWithItems: (...a) => h.repo.createQrRequestWithItems(...a),
  findPendingQrRequests: (...a) => h.repo.findPendingQrRequests(...a),
  findQrRequestForResolution: (...a) => h.repo.findQrRequestForResolution(...a),
  markQrRequestRejected: (...a) => h.repo.markQrRequestRejected(...a),
  confirmQrRequestWithRound: (...a) => h.repo.confirmQrRequestWithRound(...a),
}));
vi.mock('../clients/catalogClient.js', () => ({
  catalogClient: {
    getProductsByIds: async (ids) => ids.map((id) => h.catalog.get(id)).filter(Boolean),
  },
}));
vi.mock('../services/tableStatus.service.js', () => ({
  getTableStatus: async () => ({ tableId: h.TABLE.tableId, pendingCalls: [] }),
}));

const ORDER_ID = '44444444-4444-4444-8444-444444444444';
const WAITER_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_WAITER = '77777777-7777-4777-8777-777777777777';
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const P3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SEND = '/api/orders/qr/TOKEN-4/request';
const LIST = '/api/orders/qr-requests';
const confirmUrl = (id) => `/api/orders/qr-requests/${id}/confirm`;
const rejectUrl = (id) => `/api/orders/qr-requests/${id}/reject`;
const BODY = {
  items: [
    { productId: P1, quantity: 2, note: 'sin cebolla' },
    { productId: P2, quantity: 1 },
  ],
};

let app;
const waiter = () => tokenFor('WAITER', { userId: WAITER_ID });
const send = (body = BODY) => call(app.base, 'POST', SEND, { body });
const list = (token = waiter()) => call(app.base, 'GET', LIST, { token });
const confirm = (id, body, token = waiter()) =>
  call(app.base, 'PUT', confirmUrl(id), { token, body });
const reject = (id, token = waiter()) => call(app.base, 'PUT', rejectUrl(id), { token });
const events = (name) => h.emitted.filter((e) => e.event === name);

beforeAll(async () => {
  // El io real del modulo de eventos, con un doble que solo registra lo emitido
  setIo(h.io);
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  h.db.order = { orderId: ORDER_ID, waiterId: WAITER_ID, status: 'ABIERTA' };
  h.db.requests.length = 0;
  h.db.rounds.length = 0;
  h.emitted.length = 0;
  h.catalog.clear();
  h.catalog.set(P1, { productId: P1, name: 'Pizza Margarita', price: 28000, isAvailable: true });
  h.catalog.set(P2, { productId: P2, name: 'Limonada', price: 7000, isAvailable: true });
  h.catalog.set(P3, { productId: P3, name: 'Tiramisu', price: 15000, isAvailable: false });
});

describe('criterio 1: solicitud enviada (mesa ocupada)', () => {
  it('crea la solicitud pendiente y avisa SOLO al mesero asignado, sin tocar cocina ni la sala de meseros', async () => {
    const res = await send();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'pendiente',
      orderId: ORDER_ID,
      resolvedAt: null,
      resolvedBy: null,
    });
    expect(res.body.items).toEqual([
      { productId: P1, quantity: 2, note: 'sin cebolla' },
      { productId: P2, quantity: 1 },
    ]);

    const created = events('qr_request:created');
    expect(created).toHaveLength(1);
    expect(created[0].room).toBe(`waiter:${WAITER_ID}`);
    expect(created[0].payload).toMatchObject({ qrRequestId: res.body.qrRequestId, tableNumber: 4 });
    expect(h.emitted.filter((e) => e.room === 'kitchen' || e.room === 'waiters')).toEqual([]);
  });

  it('todavia no hay ronda ni precio guardado: el precio se toma recien al confirmar (R3, R4)', async () => {
    await send();
    expect(h.db.rounds).toHaveLength(0);
    expect(JSON.stringify(h.db.requests)).not.toMatch(/price|precio|unitPrice/i);
  });

  it('el mesero la recupera con el listado (respaldo del evento) y el cocinero no puede', async () => {
    const { body: created } = await send();
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      qrRequestId: created.qrRequestId,
      tableNumber: 4,
      status: 'pendiente',
    });
    expect((await list(tokenFor('COOK'))).status).toBe(403);
  });

  it('un cliente sin sesion puede enviar, pero NO puede listar, confirmar ni rechazar', async () => {
    const { body: created } = await send();
    expect((await call(app.base, 'GET', LIST, {})).status).toBe(401);
    expect((await call(app.base, 'PUT', confirmUrl(created.qrRequestId), {})).status).toBe(401);
    expect((await call(app.base, 'PUT', rejectUrl(created.qrRequestId), {})).status).toBe(401);
  });
});

describe('criterio 2: mesa no abierta', () => {
  it('con la mesa libre responde 409 TABLE_NOT_OPEN y no crea ni avisa nada', async () => {
    h.db.order = null;
    const res = await send();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TABLE_NOT_OPEN');
    expect(h.db.requests).toHaveLength(0);
    expect(h.emitted).toEqual([]);
  });

  it('con la mesa en cobro responde 409 INVALID_TRANSITION (ya no se aceptan pedidos)', async () => {
    h.db.order.status = 'EN_COBRO';
    const res = await send();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
    expect(h.db.requests).toHaveLength(0);
  });

  it('token desconocido responde 404 sin pistas', async () => {
    const res = await call(app.base, 'POST', '/api/orders/qr/otro-token/request', { body: BODY });
    expect(res.status).toBe(404);
    expect(h.db.requests).toHaveLength(0);
  });
});

describe('criterio 3: confirmacion del mesero', () => {
  it('crea una ronda con origen QR ligada a la solicitud y la manda a cocina como cualquier otra', async () => {
    const { body: created } = await send();
    h.emitted.length = 0;

    const res = await confirm(created.qrRequestId);
    expect(res.status).toBe(200);
    expect(res.body.round).toMatchObject({
      source: 'QR',
      qrRequestId: created.qrRequestId,
      createdBy: WAITER_ID,
      orderId: ORDER_ID,
    });
    expect(res.body.round.items).toHaveLength(2);
    expect(res.body.round.items[0]).toMatchObject({
      productName: 'Pizza Margarita',
      unitPrice: 28000,
      quantity: 2,
      note: 'sin cebolla',
      status: 'pendiente',
    });

    const toKitchen = events('round:created');
    expect(toKitchen).toHaveLength(1);
    expect(toKitchen[0].room).toBe('kitchen');
    expect(toKitchen[0].payload).toMatchObject({ source: 'QR', tableNumber: 4 });
    expect(events('table:status_changed')).toHaveLength(1);

    expect(h.db.requests[0]).toMatchObject({ status: 'confirmada', resolvedBy: WAITER_ID });
    expect((await list()).body).toEqual([]);
  });

  it('el snapshot del precio se toma al CONFIRMAR, no al enviar (R3)', async () => {
    const { body: created } = await send();
    h.catalog.set(P1, { productId: P1, name: 'Pizza Margarita', price: 31000, isAvailable: true });
    const res = await confirm(created.qrRequestId);
    expect(res.body.round.items.find((i) => i.productId === P1).unitPrice).toBe(31000);
  });

  it('el mesero puede ajustar los items: los suyos reemplazan a los del cliente', async () => {
    const { body: created } = await send();
    const res = await confirm(created.qrRequestId, { items: [{ productId: P2, quantity: 5 }] });
    expect(res.status).toBe(200);
    expect(res.body.round.items).toHaveLength(1);
    expect(res.body.round.items[0]).toMatchObject({ productId: P2, quantity: 5, unitPrice: 7000 });
  });

  it('un producto que se agoto desde que se envio se omite y se informa; el resto pasa', async () => {
    const { body: created } = await send();
    h.catalog.set(P2, { productId: P2, name: 'Limonada', price: 7000, isAvailable: false });
    const res = await confirm(created.qrRequestId);
    expect(res.status).toBe(200);
    expect(res.body.round.items).toHaveLength(1);
    expect(res.body.unavailable).toEqual([{ productId: P2, name: 'Limonada' }]);
  });

  it('si no queda ningun producto disponible responde 409 y la solicitud SIGUE pendiente', async () => {
    const { body: created } = await send({ items: [{ productId: P1, quantity: 1 }] });
    h.catalog.set(P1, { productId: P1, name: 'Pizza Margarita', price: 28000, isAvailable: false });
    const res = await confirm(created.qrRequestId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_AVAILABLE_ITEMS');
    expect(h.db.requests[0].status).toBe('pendiente');
    expect(h.db.rounds).toHaveLength(0);
    expect((await list()).body).toHaveLength(1);
  });

  it('confirmarla dos veces no duplica la ronda: la segunda responde 409', async () => {
    const { body: created } = await send();
    expect((await confirm(created.qrRequestId)).status).toBe(200);
    const again = await confirm(created.qrRequestId);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_TRANSITION');
    expect(h.db.rounds).toHaveLength(1);
  });

  it('si la mesa paso a cobro antes de confirmar, responde 409 y no crea ronda', async () => {
    const { body: created } = await send();
    h.db.order.status = 'EN_COBRO';
    const res = await confirm(created.qrRequestId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
    expect(h.db.rounds).toHaveLength(0);
    expect(h.db.requests[0].status).toBe('pendiente');
  });
});

describe('criterio 4: rechazo del mesero', () => {
  it('pasa a rechazada, no crea ronda ni avisa a cocina, y sale del listado', async () => {
    const { body: created } = await send();
    h.emitted.length = 0;

    const res = await reject(created.qrRequestId);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      qrRequestId: created.qrRequestId,
      status: 'rechazada',
      resolvedBy: WAITER_ID,
    });
    expect(res.body.resolvedAt).not.toBeNull();
    expect(res.body).not.toHaveProperty('round');

    expect(h.db.rounds).toHaveLength(0);
    expect(events('round:created')).toEqual([]);
    expect((await list()).body).toEqual([]);
  });

  it('una solicitud rechazada ya no se puede confirmar ni rechazar de nuevo (409)', async () => {
    const { body: created } = await send();
    await reject(created.qrRequestId);
    expect((await confirm(created.qrRequestId)).status).toBe(409);
    expect((await reject(created.qrRequestId)).status).toBe(409);
    expect(h.db.rounds).toHaveLength(0);
  });

  it('se puede rechazar aunque la mesa ya este en cobro (limpiar lo que ya no se atiende)', async () => {
    const { body: created } = await send();
    h.db.order.status = 'EN_COBRO';
    expect((await reject(created.qrRequestId)).status).toBe(200);
  });
});

describe('reglas que atraviesan todo el flujo', () => {
  it('maximo 3 pendientes por orden; al resolver una se libera el cupo', async () => {
    const ids = [];
    for (let i = 0; i < 3; i += 1) ids.push((await send()).body.qrRequestId);
    const fourth = await send();
    expect(fourth.status).toBe(409);
    expect(fourth.body.error.code).toBe('CONFLICT');
    expect(fourth.body.error.details).toEqual({ pending: 3 });

    await reject(ids[0]);
    expect((await send()).status).toBe(201);
  });

  it('un producto agotado o inexistente al enviar se rechaza completo y no deja nada guardado', async () => {
    const soldOut = await send({ items: [{ productId: P3, quantity: 1 }] });
    expect(soldOut.status).toBe(409);
    expect(soldOut.body.error.details.unavailable).toEqual([{ productId: P3, name: 'Tiramisu' }]);
    const unknown = await send({
      items: [{ productId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', quantity: 1 }],
    });
    expect(unknown.status).toBe(400);
    expect(h.db.requests).toHaveLength(0);
    expect(h.emitted).toEqual([]);
  });

  it('el cliente nunca decide precios, estado ni orden: esos campos se rechazan', async () => {
    const res = await send({
      items: [{ productId: P1, quantity: 1, unitPrice: 1 }],
      status: 'confirmada',
    });
    expect(res.status).toBe(400);
    expect(h.db.requests).toHaveLength(0);
  });

  it('solo el mesero asignado (o el ADMIN) resuelve: otro mesero y el cocinero reciben 403', async () => {
    const { body: created } = await send();
    const other = tokenFor('WAITER', { userId: OTHER_WAITER });
    expect((await confirm(created.qrRequestId, undefined, other)).status).toBe(403);
    expect((await reject(created.qrRequestId, other)).status).toBe(403);
    expect((await confirm(created.qrRequestId, undefined, tokenFor('COOK'))).status).toBe(403);
    expect(h.db.requests[0].status).toBe('pendiente');

    const admin = tokenFor('ADMIN', { userId: '99999999-9999-4999-8999-999999999999' });
    expect((await confirm(created.qrRequestId, undefined, admin)).status).toBe(200);
  });

  it('un mesero solo ve en el listado las solicitudes de sus mesas; el ADMIN ve todas', async () => {
    await send();
    const other = tokenFor('WAITER', { userId: OTHER_WAITER });
    expect((await list(other)).body).toEqual([]);
    expect((await list(tokenFor('ADMIN'))).body).toHaveLength(1);
  });
});
