// Solicitud de pedido desde el QR (GC-QR-0003, GC-139 y GC-140) con la app real (rutas, validacion, errores,
// Socket.io simulado). Simulados: los repositorios (sin base de datos), el catalogo y el io.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogClient } from '../clients/catalogClient.js';
import { AppError } from '../errors/AppError.js';
import {
  countPendingQrRequests,
  createQrRequestWithItems,
} from '../repositories/qrRequest.repository.js';
import { findTableByQrToken } from '../repositories/serviceCall.repository.js';
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
vi.mock('../repositories/qrRequest.repository.js', () => ({
  countPendingQrRequests: vi.fn(),
  createQrRequestWithItems: vi.fn(),
}));
vi.mock('../clients/catalogClient.js', () => ({ catalogClient: { getProductsByIds: vi.fn() } }));
vi.mock('../realtime/events.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getIo: () => {
    if (hoisted.state.ioFails) throw new Error('Socket.io no inicializado');
    return hoisted.io;
  },
}));

const TABLE_ID = '33333333-3333-4333-8333-333333333333';
const ORDER_ID = '44444444-4444-4444-8444-444444444444';
const WAITER_ID = '55555555-5555-4555-8555-555555555555';
const REQUEST_ID = '66666666-6666-4666-8666-666666666666';
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const P3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TOKEN = 'Zm9vYmFyYmF6cXV4c29tZXRva2VuMTIzNDU2Nzg5MDEyMw';
const URL = (token = TOKEN) => `/api/orders/qr/${token}/request`;

const order = (status = 'ABIERTA') => ({ orderId: ORDER_ID, waiterId: WAITER_ID, status });
const TABLE_BUSY = { tableId: TABLE_ID, tableNumber: 4, orders: [order()] };
const PRODUCTS = [
  { productId: P1, name: 'Pizza Margarita', price: 28000, isAvailable: true },
  { productId: P2, name: 'Limonada', price: 7000, isAvailable: true },
  { productId: P3, name: 'Tiramisu', price: 15000, isAvailable: false },
];
const BODY = {
  items: [
    { productId: P1, quantity: 2, note: 'sin cebolla' },
    { productId: P2, quantity: 1 },
  ],
};
const p2003 = () => Object.assign(new Error('FK'), { code: 'P2003' });

let app;
beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  hoisted.emitted.length = 0;
  hoisted.state.ioFails = false;
  findTableByQrToken.mockResolvedValue(TABLE_BUSY);
  countPendingQrRequests.mockResolvedValue(0);
  catalogClient.getProductsByIds.mockImplementation(async (ids) =>
    PRODUCTS.filter((p) => ids.includes(p.productId)),
  );
  createQrRequestWithItems.mockImplementation(async ({ orderId }) => ({
    qrRequestId: REQUEST_ID,
    orderId,
    status: 'pendiente',
    createdAt: new Date('2026-11-08T15:00:00Z'),
    resolvedAt: null,
    resolvedBy: null,
  }));
});

describe('solicitud enviada con la mesa ocupada', () => {
  it('es publica: crea la qr_request pendiente con los items enviados -> 201', async () => {
    const res = await call(app.base, 'POST', URL(), { body: BODY });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      qrRequestId: REQUEST_ID,
      orderId: ORDER_ID,
      status: 'pendiente',
      createdAt: '2026-11-08T15:00:00.000Z',
      resolvedAt: null,
      resolvedBy: null,
      items: [
        { productId: P1, quantity: 2, note: 'sin cebolla' },
        { productId: P2, quantity: 1 },
      ],
    });
    expect(createQrRequestWithItems).toHaveBeenCalledWith({ orderId: ORDER_ID, items: BODY.items });
  });

  it('emite qr_request:created SOLO al mesero asignado (waiter:{id}), nunca a toda la sala waiters', async () => {
    await call(app.base, 'POST', URL(), { body: BODY });
    expect(hoisted.emitted).toHaveLength(1);
    expect(hoisted.emitted[0].room).toBe(`waiter:${WAITER_ID}`);
    expect(hoisted.emitted[0].event).toBe('qr_request:created');
    expect(hoisted.emitted[0].payload).toMatchObject({
      qrRequestId: REQUEST_ID,
      orderId: ORDER_ID,
      status: 'pendiente',
      tableNumber: 4,
      items: [
        { productId: P1, quantity: 2, note: 'sin cebolla' },
        { productId: P2, quantity: 1 },
      ],
    });
  });

  it('el mismo producto en dos lineas se permite (por ejemplo, uno con nota y otro sin ella)', async () => {
    const body = {
      items: [
        { productId: P1, quantity: 1, note: 'sin cebolla' },
        { productId: P1, quantity: 1 },
      ],
    };
    expect((await call(app.base, 'POST', URL(), { body })).status).toBe(201);
    expect(catalogClient.getProductsByIds).toHaveBeenCalledWith([P1]); // se consulta una sola vez
  });

  it('recorta la nota; una nota solo con espacios se guarda como "sin nota"', async () => {
    const body = {
      items: [
        { productId: P1, quantity: 1, note: '  poco hielo  ' },
        { productId: P2, quantity: 1, note: '   ' },
      ],
    };
    const res = await call(app.base, 'POST', URL(), { body });
    expect(res.status).toBe(201);
    expect(createQrRequestWithItems.mock.calls[0][0].items).toEqual([
      { productId: P1, quantity: 1, note: 'poco hielo' },
      { productId: P2, quantity: 1 },
    ]);
    expect(res.body.items[1]).toEqual({ productId: P2, quantity: 1 });
  });

  it('no necesita sesion: una cabecera Authorization cualquiera se ignora', async () => {
    const res = await fetch(app.base + URL(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer basura' },
      body: JSON.stringify(BODY),
    });
    expect(res.status).toBe(201);
  });

  it('el precio no se guarda ni se consulta para guardar: el snapshot (R3) es al confirmar', async () => {
    await call(app.base, 'POST', URL(), { body: BODY });
    const saved = JSON.stringify(createQrRequestWithItems.mock.calls[0][0]);
    expect(saved).not.toMatch(/price|unitPrice|28000/);
  });
});

describe('mesa que no admite solicitudes', () => {
  it('mesa libre -> 409 TABLE_NOT_OPEN y no se consulta el catalogo, ni se crea, ni se avisa', async () => {
    findTableByQrToken.mockResolvedValue({ tableId: TABLE_ID, tableNumber: 4, orders: [] });
    const res = await call(app.base, 'POST', URL(), { body: BODY });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TABLE_NOT_OPEN');
    expect(catalogClient.getProductsByIds).not.toHaveBeenCalled();
    expect(createQrRequestWithItems).not.toHaveBeenCalled();
    expect(hoisted.emitted).toEqual([]);
  });

  it('mesa en cobro -> 409 INVALID_TRANSITION (ya no se aceptan pedidos)', async () => {
    findTableByQrToken.mockResolvedValue({ ...TABLE_BUSY, orders: [order('EN_COBRO')] });
    const res = await call(app.base, 'POST', URL(), { body: BODY });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
    expect(createQrRequestWithItems).not.toHaveBeenCalled();
    expect(hoisted.emitted).toEqual([]);
  });

  it('token desconocido -> 404 NOT_FOUND', async () => {
    findTableByQrToken.mockResolvedValue(null);
    const res = await call(app.base, 'POST', URL('token-que-no-existe'), { body: BODY });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(createQrRequestWithItems).not.toHaveBeenCalled();
  });

  it('token de mas de 255 caracteres -> 404 sin consultar la base', async () => {
    const res = await call(app.base, 'POST', URL('a'.repeat(256)), { body: BODY });
    expect(res.status).toBe(404);
    expect(findTableByQrToken).not.toHaveBeenCalled();
  });
});

describe('tope de solicitudes pendientes', () => {
  it('con 3 pendientes por revisar -> 409 CONFLICT y no se crea otra', async () => {
    countPendingQrRequests.mockResolvedValue(3);
    const res = await call(app.base, 'POST', URL(), { body: BODY });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.details).toEqual({ pending: 3 });
    expect(countPendingQrRequests).toHaveBeenCalledWith(ORDER_ID);
    expect(createQrRequestWithItems).not.toHaveBeenCalled();
    expect(hoisted.emitted).toEqual([]);
  });

  it('con 2 pendientes todavia se acepta la tercera', async () => {
    countPendingQrRequests.mockResolvedValue(2);
    expect((await call(app.base, 'POST', URL(), { body: BODY })).status).toBe(201);
  });
});

describe('productos', () => {
  it('un producto que no existe -> 400 VALIDATION_ERROR indicando en que linea', async () => {
    const body = {
      items: [
        { productId: P1, quantity: 1 },
        { productId: '99999999-9999-4999-8999-999999999999', quantity: 1 },
      ],
    };
    const res = await call(app.base, 'POST', URL(), { body });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields).toEqual([
      { path: 'items.1.productId', message: 'El producto no existe' },
    ]);
    expect(createQrRequestWithItems).not.toHaveBeenCalled();
  });

  it('un producto agotado -> 409 CONFLICT con la lista, y se rechaza TODA la solicitud (nada se recorta en silencio)', async () => {
    const body = {
      items: [
        { productId: P1, quantity: 1 },
        { productId: P3, quantity: 1 },
      ],
    };
    const res = await call(app.base, 'POST', URL(), { body });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.details.unavailable).toEqual([{ productId: P3, name: 'Tiramisu' }]);
    expect(createQrRequestWithItems).not.toHaveBeenCalled();
    expect(hoisted.emitted).toEqual([]);
  });

  it('si el catalogo no responde -> 503 DEPENDENCY_UNAVAILABLE y no se crea nada', async () => {
    catalogClient.getProductsByIds.mockRejectedValue(
      new AppError({ status: 503, code: 'DEPENDENCY_UNAVAILABLE', message: 'catalogo caido' }),
    );
    const res = await call(app.base, 'POST', URL(), { body: BODY });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(createQrRequestWithItems).not.toHaveBeenCalled();
  });
});

describe('validacion de la solicitud (400)', () => {
  const items = (...lines) => ({ items: lines });
  const one = (over) => items({ productId: P1, quantity: 1, ...over });

  it.each([
    ['sin items', {}],
    ['items vacio', { items: [] }],
    ['items que no es un arreglo', { items: 'pizza' }],
    [
      'mas de 20 items',
      { items: Array.from({ length: 21 }, () => ({ productId: P1, quantity: 1 })) },
    ],
    ['cantidad 0', one({ quantity: 0 })],
    ['cantidad negativa', one({ quantity: -1 })],
    ['cantidad decimal', one({ quantity: 1.5 })],
    ['cantidad como texto', one({ quantity: '2' })],
    ['cantidad mayor a 99', one({ quantity: 100 })],
    ['cantidad que desbordaria el INT de la base', one({ quantity: 2 ** 31 })],
    ['nota de mas de 255 caracteres', one({ note: 'x'.repeat(256) })],
    ['nota que no es texto', one({ note: 5 })],
    ['productId que no es UUID', one({ productId: 'pizza' })],
    ['sin productId', items({ quantity: 1 })],
    ['el cliente intenta fijar un precio', one({ unitPrice: 1 })],
    ['el cliente intenta fijar el estado', { ...BODY, status: 'confirmada' }],
    ['el cliente intenta fijar la orden', { ...BODY, orderId: ORDER_ID }],
  ])('rechaza %s -> 400 y no consulta nada', async (_name, body) => {
    const res = await call(app.base, 'POST', URL(), { body });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(findTableByQrToken).not.toHaveBeenCalled();
    expect(createQrRequestWithItems).not.toHaveBeenCalled();
  });

  it('acepta exactamente 20 items y una nota de exactamente 255 caracteres', async () => {
    const twenty = {
      items: Array.from({ length: 20 }, () => ({
        productId: P1,
        quantity: 99,
        note: 'x'.repeat(255),
      })),
    };
    expect((await call(app.base, 'POST', URL(), { body: twenty })).status).toBe(201);
  });

  it('JSON mal formado -> 400', async () => {
    const res = await call(app.base, 'POST', URL(), { rawBody: '{x' });
    expect(res.status).toBe(400);
  });
});

describe('fallos', () => {
  it('si falla el aviso en tiempo real, la solicitud ya esta guardada: sigue siendo 201', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    hoisted.state.ioFails = true;
    expect((await call(app.base, 'POST', URL(), { body: BODY })).status).toBe(201);
    expect(createQrRequestWithItems).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it('la orden se cierra justo entre la consulta y el alta (FK, P2003) -> 404', async () => {
    createQrRequestWithItems.mockRejectedValue(p2003());
    expect((await call(app.base, 'POST', URL(), { body: BODY })).status).toBe(404);
  });

  it('error inesperado de la base -> 500 sin filtrar detalles y sin avisar', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    createQrRequestWithItems.mockRejectedValue(new Error('password=secreto'));
    const res = await call(app.base, 'POST', URL(), { body: BODY });
    expect(res.status).toBe(500);
    expect(res.text).not.toContain('secreto');
    expect(hoisted.emitted).toEqual([]);
    spy.mockRestore();
  });
});

describe('rutas', () => {
  it('solo existe POST: un GET a la misma ruta no hace nada', async () => {
    const res = await call(app.base, 'GET', URL());
    expect(res.status).toBe(404);
    expect(createQrRequestWithItems).not.toHaveBeenCalled();
  });

  it('el llamado al mesero sigue funcionando junto a esta ruta (mismo token, otra accion)', async () => {
    const res = await call(app.base, 'POST', `/api/orders/qr/${TOKEN}/call`);
    expect(res.status).not.toBe(404);
  });
});
