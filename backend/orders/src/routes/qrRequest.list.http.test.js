// Listar las solicitudes QR pendientes (respaldo del evento qr_request:created) con la app real
// (rutas, JWT, validacion, errores). Solo el repositorio va simulado: no hace falta base de datos.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { findPendingQrRequests } from '../repositories/qrRequest.repository.js';
import { call, startApp, tokenFor } from '../test/helpers.js';

// Evita que los repositorios de las demas rutas construyan un PrismaClient real al cargar la app
vi.mock('../config/prisma.js', () => ({ prisma: {} }));
vi.mock('../repositories/qrRequest.repository.js', () => ({
  countPendingQrRequests: vi.fn(),
  createQrRequestWithItems: vi.fn(),
  findPendingQrRequests: vi.fn(),
}));

const URL = '/api/orders/qr-requests';
const WAITER_ID = '55555555-5555-4555-8555-555555555555';
const ORDER_ID = '44444444-4444-4444-8444-444444444444';
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// Fila tal como la devuelve Prisma (con items y la mesa de la orden)
const row = (over = {}) => ({
  qrRequestId: '66666666-6666-4666-8666-666666666666',
  orderId: ORDER_ID,
  status: 'pendiente',
  createdAt: new Date('2026-11-08T15:00:00Z'),
  resolvedAt: null,
  resolvedBy: null,
  items: [
    { qrRequestItemId: 'x1', qrRequestId: 'r', productId: P1, quantity: 2, note: 'sin cebolla' },
    { qrRequestItemId: 'x2', qrRequestId: 'r', productId: P2, quantity: 1, note: null },
  ],
  order: { table: { tableNumber: 4 } },
  ...over,
});

let app;
const as = (role, userId = WAITER_ID) => tokenFor(role, { userId });
const get = (token, path = URL) => call(app.base, 'GET', path, { token });

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  findPendingQrRequests.mockResolvedValue([row()]);
});

describe('acceso', () => {
  it('sin sesion -> 401 (a diferencia de /qr/:token/*, esta ruta no es publica)', async () => {
    const res = await get(undefined);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(findPendingQrRequests).not.toHaveBeenCalled();
  });

  it('el cocinero -> 403', async () => {
    const res = await get(as('COOK'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(findPendingQrRequests).not.toHaveBeenCalled();
  });

  it.each(['WAITER', 'ADMIN'])('un %s autenticado puede consultarlas', async (role) => {
    expect((await get(as(role))).status).toBe(200);
  });
});

describe('quien ve que', () => {
  it('un mesero solo ve las solicitudes de SUS mesas (filtra por su userId)', async () => {
    await get(as('WAITER', WAITER_ID));
    expect(findPendingQrRequests).toHaveBeenCalledWith({ waiterId: WAITER_ID });
  });

  it('el ADMIN ve las de todas las mesas (sin filtro de mesero)', async () => {
    await get(as('ADMIN', 'admin-1'));
    expect(findPendingQrRequests).toHaveBeenCalledWith({ waiterId: undefined });
  });
});

describe('respuesta', () => {
  it('es el mismo formato que el evento qr_request:created: la QrRequest del contrato mas tableNumber', async () => {
    const res = await get(as('WAITER'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        qrRequestId: '66666666-6666-4666-8666-666666666666',
        orderId: ORDER_ID,
        status: 'pendiente',
        createdAt: '2026-11-08T15:00:00.000Z',
        resolvedAt: null,
        resolvedBy: null,
        items: [
          { productId: P1, quantity: 2, note: 'sin cebolla' },
          { productId: P2, quantity: 1 },
        ],
        tableNumber: 4,
      },
    ]);
  });

  it('no filtra campos internos de la base (ids de los items, relaciones)', async () => {
    const res = await get(as('WAITER'));
    expect(JSON.stringify(res.body)).not.toMatch(/qrRequestItemId|"order"/);
  });

  it('sin solicitudes pendientes -> []', async () => {
    findPendingQrRequests.mockResolvedValue([]);
    const res = await get(as('WAITER'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('conserva el orden que entrega la consulta (la mas antigua primero) y varias mesas a la vez', async () => {
    findPendingQrRequests.mockResolvedValue([
      row({ qrRequestId: 'a', createdAt: new Date('2026-11-08T15:00:00Z') }),
      row({
        qrRequestId: 'b',
        createdAt: new Date('2026-11-08T15:05:00Z'),
        order: { table: { tableNumber: 7 } },
      }),
    ]);
    const res = await get(as('ADMIN'));
    expect(res.body.map((r) => [r.qrRequestId, r.tableNumber])).toEqual([
      ['a', 4],
      ['b', 7],
    ]);
  });
});

describe('rutas y validacion', () => {
  it('no la captura GET /api/orders/:orderId: devuelve la lista, no un 400 de UUID', async () => {
    const res = await get(as('WAITER'));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it.each(['?status=confirmada', '?status=pendiente', '?waiterId=x', '?limit=5'])(
    'un parametro de consulta (%s) -> 400: el listado no acepta filtros',
    async (query) => {
      const res = await get(as('WAITER'), URL + query);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(findPendingQrRequests).not.toHaveBeenCalled();
    },
  );

  it('solo lectura: un POST a esta ruta no hace nada', async () => {
    const res = await call(app.base, 'POST', URL, { token: as('WAITER'), body: {} });
    expect(res.status).toBe(404);
  });

  it('error inesperado de la base -> 500 sin filtrar detalles', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    findPendingQrRequests.mockRejectedValue(new Error('password=secreto'));
    const res = await get(as('WAITER'));
    expect(res.status).toBe(500);
    expect(res.text).not.toContain('secreto');
    spy.mockRestore();
  });
});
