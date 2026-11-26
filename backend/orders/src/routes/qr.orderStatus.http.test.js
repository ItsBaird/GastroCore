// GET /api/orders/qr/:token/order con la app real: publico, de solo lectura y sin ids internos.
// Solo la base de datos va simulada (busqueda de la mesa por qr_token y detalle de la orden).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { findOrderStatusForQr } from '../repositories/qrOrderStatus.repository.js';
import { findTableByQrToken } from '../repositories/serviceCall.repository.js';
import { startApp } from '../test/helpers.js';

vi.mock('../config/prisma.js', () => ({ prisma: {} }));
vi.mock('../repositories/serviceCall.repository.js', () => ({
  findTableByQrToken: vi.fn(),
  createServiceCall: vi.fn(),
}));
vi.mock('../repositories/qrOrderStatus.repository.js', () => ({ findOrderStatusForQr: vi.fn() }));

const TOKEN = 'Zm9vYmFyYmF6cXV4c29tZXRva2VuMTIzNDU2Nzg5MDEyMw';
const TABLE_ID = '33333333-3333-4333-8333-333333333333';
const ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const WAITER_ID = '44444444-4444-4444-8444-444444444444';
const ITEM_ID = '55555555-5555-4555-8555-555555555555';
const PRODUCT_ID = '66666666-6666-4666-8666-666666666666';
const CREATED_AT = new Date('2026-11-26T18:00:00.000Z');

const table = (orders) => ({ tableId: TABLE_ID, tableNumber: 5, orders });
const openOrder = (status = 'ABIERTA') => ({ orderId: ORDER_ID, waiterId: WAITER_ID, status });
const item = (overrides = {}) => ({
  itemId: ITEM_ID,
  productNameSnapshot: 'Pizza Margarita',
  unitPriceSnapshot: 16000,
  quantity: 2,
  note: null,
  status: 'en_preparacion',
  ...overrides,
});
const detail = (overrides = {}) => ({
  status: 'ABIERTA',
  discountAmount: 0,
  rounds: [{ items: [item()] }],
  qrRequests: [],
  ...overrides,
});

let app;
beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
});

async function get(token = TOKEN, headers = {}) {
  const res = await fetch(`${app.base}/api/orders/qr/${token}/order`, { headers });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

describe('GET /api/orders/qr/:token/order', () => {
  it('mesa libre: 200 vacio, sin consultar la orden', async () => {
    findTableByQrToken.mockResolvedValue(table([]));

    const res = await get();

    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toEqual({
      tableNumber: 5,
      status: 'libre',
      requests: [],
      items: [],
      subtotal: 0,
      discountAmount: 0,
      total: 0,
    });
    expect(findOrderStatusForQr).not.toHaveBeenCalled();
  });

  it('mesa ocupada: items con su estado, solicitudes sin resolver y total de computeBill', async () => {
    findTableByQrToken.mockResolvedValue(table([openOrder()]));
    findOrderStatusForQr.mockResolvedValue(
      detail({
        rounds: [
          {
            items: [
              item(),
              item({
                productNameSnapshot: 'Limonada',
                unitPriceSnapshot: 5000,
                quantity: 1,
                status: 'entregado',
                note: 'Sin hielo',
              }),
            ],
          },
          { items: [item({ status: 'cancelado', quantity: 1 })] },
        ],
        qrRequests: [
          {
            status: 'pendiente',
            createdAt: CREATED_AT,
            items: [{ productId: PRODUCT_ID, quantity: 1, note: 'Extra queso' }],
          },
        ],
      }),
    );

    const res = await get();
    const body = JSON.parse(res.text);

    expect(res.status).toBe(200);
    expect(findOrderStatusForQr).toHaveBeenCalledWith(ORDER_ID);
    expect(body).toEqual({
      tableNumber: 5,
      status: 'ocupada',
      requests: [
        {
          status: 'pendiente',
          createdAt: CREATED_AT.toISOString(),
          items: [{ productId: PRODUCT_ID, quantity: 1, note: 'Extra queso' }],
        },
      ],
      items: [
        {
          productName: 'Pizza Margarita',
          quantity: 2,
          note: null,
          status: 'en_preparacion',
          lineTotal: 32000,
        },
        {
          productName: 'Limonada',
          quantity: 1,
          note: 'Sin hielo',
          status: 'entregado',
          lineTotal: 5000,
        },
        {
          productName: 'Pizza Margarita',
          quantity: 1,
          note: null,
          status: 'cancelado',
          lineTotal: 16000,
        },
      ],
      // el cancelado no suma
      subtotal: 37000,
      discountAmount: 0,
      total: 37000,
    });
  });

  it('mesa en cobro: estado en_cobro y total con el descuento', async () => {
    findTableByQrToken.mockResolvedValue(table([openOrder('EN_COBRO')]));
    findOrderStatusForQr.mockResolvedValue(detail({ status: 'EN_COBRO', discountAmount: 2000 }));

    const body = JSON.parse((await get()).text);

    expect(body.status).toBe('en_cobro');
    expect(body).toMatchObject({ subtotal: 32000, discountAmount: 2000, total: 30000 });
  });

  it('la orden se cerro entre las dos consultas: responde como mesa libre', async () => {
    findTableByQrToken.mockResolvedValue(table([openOrder()]));
    findOrderStatusForQr.mockResolvedValue(detail({ status: 'CERRADA' }));

    const body = JSON.parse((await get()).text);

    expect(body).toMatchObject({ status: 'libre', items: [], requests: [], total: 0 });
  });

  it('no expone ids de mesa, orden, mesero ni items; no se cachea', async () => {
    findTableByQrToken.mockResolvedValue(table([openOrder()]));
    findOrderStatusForQr.mockResolvedValue(detail());

    const res = await get();

    for (const secret of [TABLE_ID, ORDER_ID, WAITER_ID, ITEM_ID, TOKEN]) {
      expect(res.text).not.toContain(secret);
    }
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('publico: funciona sin Authorization e ignora un JWT invalido', async () => {
    findTableByQrToken.mockResolvedValue(table([]));

    expect((await get(TOKEN, { Authorization: 'Bearer no.es.un.jwt' })).status).toBe(200);
  });

  it('token inexistente o malformado: el mismo 404 del canal QR', async () => {
    findTableByQrToken.mockResolvedValue(null);
    const missing = await get();
    const malformed = await get('x'.repeat(300));

    expect(missing.status).toBe(404);
    expect(malformed.status).toBe(404);
    expect(JSON.parse(missing.text).error.code).toBe('NOT_FOUND');
    expect(malformed.text).not.toContain('xxxx');
  });
});
