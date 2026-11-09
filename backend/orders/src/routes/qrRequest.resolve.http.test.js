// Confirmar y rechazar solicitudes QR con la app real (rutas, JWT, validacion, errores). Se simulan el
// repositorio, el catalogo y los eventos: no hace falta base de datos ni Socket.io.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { call, startApp, tokenFor } from '../test/helpers.js';

vi.mock('../config/prisma.js', () => ({ prisma: {} }));
vi.mock('../repositories/qrRequest.repository.js');
vi.mock('../realtime/events.js');
vi.mock('../clients/catalogClient.js', () => ({ catalogClient: { getProductsByIds: vi.fn() } }));
vi.mock('../services/tableStatus.service.js');

const repo = await import('../repositories/qrRequest.repository.js');
const { catalogClient } = await import('../clients/catalogClient.js');
const events = await import('../realtime/events.js');
const { getTableStatus } = await import('../services/tableStatus.service.js');

const REQ_ID = '66666666-6666-4666-8666-666666666666';
const ORDER_ID = '44444444-4444-4444-8444-444444444444';
const WAITER_ID = '55555555-5555-4555-8555-555555555555';
const P1 = '00000000-0000-4000-a000-000000000001';
const CONFIRM = `/api/orders/qr-requests/${REQ_ID}/confirm`;
const REJECT = `/api/orders/qr-requests/${REQ_ID}/reject`;

const request = (over = {}) => ({
  qrRequestId: REQ_ID,
  orderId: ORDER_ID,
  status: 'pendiente',
  createdAt: new Date('2026-11-08T10:00:00Z'),
  resolvedAt: null,
  resolvedBy: null,
  items: [{ productId: P1, quantity: 2, note: null }],
  order: {
    orderId: ORDER_ID,
    tableId: 't1',
    status: 'ABIERTA',
    waiterId: WAITER_ID,
    table: { tableNumber: 4 },
  },
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
  repo.findQrRequestForResolution.mockResolvedValue(request());
  catalogClient.getProductsByIds.mockResolvedValue([
    { productId: P1, name: 'Pizza', price: 28000, isAvailable: true },
  ]);
  repo.confirmQrRequestWithRound.mockImplementation(async ({ items }) => ({
    roundId: 'r1',
    orderId: ORDER_ID,
    source: 'QR',
    qrRequestId: REQ_ID,
    createdBy: WAITER_ID,
    createdAt: new Date('2026-11-08T10:05:00Z'),
    items: items.map((i) => ({
      itemId: 'it1',
      roundId: 'r1',
      productId: i.productId,
      productNameSnapshot: i.productName,
      unitPriceSnapshot: i.unitPrice,
      quantity: i.quantity,
      note: i.note ?? null,
      status: 'pendiente',
    })),
  }));
  repo.markQrRequestRejected.mockResolvedValue(
    request({
      status: 'rechazada',
      resolvedBy: WAITER_ID,
      resolvedAt: new Date('2026-11-08T10:06:00Z'),
    }),
  );
  getTableStatus.mockResolvedValue({ tableId: 't1' });
});

describe.each([
  ['confirm', CONFIRM],
  ['reject', REJECT],
])('acceso comun a %s', (_name, url) => {
  it('sin sesion -> 401', async () => {
    const res = await put(url, undefined);
    expect(res.status).toBe(401);
    expect(repo.findQrRequestForResolution).not.toHaveBeenCalled();
  });

  it('el cocinero -> 403', async () => {
    const res = await put(url, as('COOK'));
    expect(res.status).toBe(403);
    expect(repo.findQrRequestForResolution).not.toHaveBeenCalled();
  });

  it('un mesero que no es el asignado -> 403', async () => {
    const res = await put(url, as('WAITER', '99999999-9999-4999-8999-999999999999'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('el id debe ser UUID -> 400', async () => {
    const res = await put(url.replace(REQ_ID, 'no-es-uuid'), as('WAITER'));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('solicitud inexistente -> 404', async () => {
    repo.findQrRequestForResolution.mockResolvedValue(null);
    const res = await put(url, as('WAITER'));
    expect(res.status).toBe(404);
  });

  it('ya resuelta -> 409 INVALID_TRANSITION', async () => {
    repo.findQrRequestForResolution.mockResolvedValue(request({ status: 'confirmada' }));
    const res = await put(url, as('WAITER'));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('el ADMIN puede resolver cualquiera', async () => {
    const res = await put(url, as('ADMIN', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
    expect(res.status).toBe(200);
  });
});

describe('PUT /qr-requests/:id/confirm', () => {
  it('sin cuerpo: 200 con la ronda QR (snapshot de precios, qrRequestId) y avisa a cocina', async () => {
    const res = await put(CONFIRM, as('WAITER'));
    expect(res.status).toBe(200);
    expect(res.body.round).toMatchObject({
      roundId: 'r1',
      source: 'QR',
      qrRequestId: REQ_ID,
      createdBy: WAITER_ID,
    });
    expect(res.body.round.items[0]).toMatchObject({
      productName: 'Pizza',
      unitPrice: 28000,
      quantity: 2,
    });
    expect(res.body).not.toHaveProperty('unavailable');
    expect(events.emitRoundCreated).toHaveBeenCalledOnce();
  });

  it('con items: el mesero ajusta cantidades', async () => {
    const res = await put(CONFIRM, as('WAITER'), { items: [{ productId: P1, quantity: 5 }] });
    expect(res.status).toBe(200);
    expect(res.body.round.items[0].quantity).toBe(5);
  });

  it('cuerpo vacio {} equivale a confirmar tal cual', async () => {
    const res = await put(CONFIRM, as('WAITER'), {});
    expect(res.status).toBe(200);
    expect(res.body.round.items[0].quantity).toBe(2);
  });

  it.each([
    ['precio enviado (R4)', { items: [{ productId: P1, quantity: 1, unitPrice: 1 }] }],
    ['items vacio', { items: [] }],
    ['cantidad 0', { items: [{ productId: P1, quantity: 0 }] }],
    ['productId no UUID', { items: [{ productId: 'pizza', quantity: 1 }] }],
    ['campo extra', { items: [{ productId: P1, quantity: 1 }], status: 'confirmada' }],
  ])('cuerpo invalido (%s) -> 400 sin tocar nada', async (_n, body) => {
    const res = await put(CONFIRM, as('WAITER'), body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(repo.confirmQrRequestWithRound).not.toHaveBeenCalled();
  });

  it('orden en cobro -> 409 INVALID_TRANSITION', async () => {
    repo.findQrRequestForResolution.mockResolvedValue(
      request({ order: { ...request().order, status: 'EN_COBRO' } }),
    );
    const res = await put(CONFIRM, as('WAITER'));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('sin productos disponibles -> 409 NO_AVAILABLE_ITEMS con la lista', async () => {
    catalogClient.getProductsByIds.mockResolvedValue([
      { productId: P1, name: 'Pizza', price: 1, isAvailable: false },
    ]);
    const res = await put(CONFIRM, as('WAITER'));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_AVAILABLE_ITEMS');
    expect(res.body.error.details.unavailable).toEqual([{ productId: P1, name: 'Pizza' }]);
  });
});

describe('PUT /qr-requests/:id/reject', () => {
  it('200 con la QrRequest rechazada y quien la resolvio; no hay ronda', async () => {
    const res = await put(REJECT, as('WAITER'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      qrRequestId: REQ_ID,
      status: 'rechazada',
      resolvedBy: WAITER_ID,
      resolvedAt: '2026-11-08T10:06:00.000Z',
    });
    expect(res.body).not.toHaveProperty('round');
    expect(repo.confirmQrRequestWithRound).not.toHaveBeenCalled();
    expect(events.emitRoundCreated).not.toHaveBeenCalled();
  });

  it('se puede rechazar con la mesa en cobro', async () => {
    repo.findQrRequestForResolution.mockResolvedValue(
      request({ order: { ...request().order, status: 'EN_COBRO' } }),
    );
    expect((await put(REJECT, as('WAITER'))).status).toBe(200);
  });

  it('un cuerpo con campos -> 400', async () => {
    const res = await put(REJECT, as('WAITER'), { status: 'confirmada' });
    expect(res.status).toBe(400);
    expect(repo.markQrRequestRejected).not.toHaveBeenCalled();
  });

  it('carrera: otro la resolvio primero -> 409', async () => {
    repo.markQrRequestRejected.mockResolvedValue(null);
    const res = await put(REJECT, as('WAITER'));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });
});

describe('rutas', () => {
  it('GET sobre /:id/confirm no existe (solo PUT)', async () => {
    const res = await call(app.base, 'GET', CONFIRM, { token: as('WAITER') });
    expect(res.status).toBe(404);
  });
});
