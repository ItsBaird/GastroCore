// GET /api/orders/qr/:token (GC-QR-0001) con la app real: publico, minimo y de solo lectura.
// Solo la base de datos va simulada (el repositorio que busca la mesa por qr_token).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServiceCall, findTableByQrToken } from '../repositories/serviceCall.repository.js';
import { startApp } from '../test/helpers.js';

vi.mock('../config/prisma.js', () => ({ prisma: {} }));
vi.mock('../repositories/serviceCall.repository.js', () => ({
  findTableByQrToken: vi.fn(),
  createServiceCall: vi.fn(),
}));

const TOKEN = 'Zm9vYmFyYmF6cXV4c29tZXRva2VuMTIzNDU2Nzg5MDEyMw'; // forma de un qrToken (base64url, 43)
const TABLE_ID = '33333333-3333-4333-8333-333333333333';
const ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const WAITER_ID = '44444444-4444-4444-8444-444444444444';

const table = (orders) => ({ tableId: TABLE_ID, tableNumber: 5, orders });
const order = (status) => ({ orderId: ORDER_ID, waiterId: WAITER_ID, status });

let app;
beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
});

// fetch directo para leer tambien las cabeceras
async function get(token = TOKEN, headers = {}) {
  const res = await fetch(`${app.base}/api/orders/qr/${token}`, { headers });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

describe('GET /api/orders/qr/:token: estado y capacidades por estado', () => {
  it('Esc. 1 mesa libre: menu y llamar; sin solicitudes ni cuenta', async () => {
    findTableByQrToken.mockResolvedValue(table([]));

    const res = await get();

    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toEqual({
      tableNumber: 5,
      status: 'libre',
      capabilities: { viewMenu: true, callWaiter: true, sendRequest: false, requestBill: false },
    });
    expect(findTableByQrToken).toHaveBeenCalledWith(TOKEN);
  });

  it('Esc. 2 mesa ocupada: ademas solicitudes de pedido y pedir la cuenta', async () => {
    findTableByQrToken.mockResolvedValue(table([order('ABIERTA')]));

    const body = JSON.parse((await get()).text);

    expect(body.status).toBe('ocupada');
    expect(body.capabilities).toEqual({
      viewMenu: true,
      callWaiter: true,
      sendRequest: true,
      requestBill: true,
    });
  });

  it('Esc. 3 mesa en cobro: menu y llamar; sin solicitudes nuevas ni cuenta', async () => {
    findTableByQrToken.mockResolvedValue(table([order('EN_COBRO')]));

    const body = JSON.parse((await get()).text);

    expect(body.status).toBe('en_cobro');
    expect(body.capabilities).toEqual({
      viewMenu: true,
      callWaiter: true,
      sendRequest: false,
      requestBill: false,
    });
  });

  it('respuesta minima: exactamente tableNumber, status y capabilities (sin ids, mesero, orden ni montos)', async () => {
    findTableByQrToken.mockResolvedValue(table([order('ABIERTA')]));

    const res = await get();
    const body = JSON.parse(res.text);

    expect(Object.keys(body).sort()).toEqual(['capabilities', 'status', 'tableNumber']);
    expect(Object.keys(body.capabilities).sort()).toEqual([
      'callWaiter',
      'requestBill',
      'sendRequest',
      'viewMenu',
    ]);
    for (const secret of [TABLE_ID, ORDER_ID, WAITER_ID, TOKEN]) {
      expect(res.text).not.toContain(secret);
    }
  });

  it('nunca se cachea (Cache-Control: no-store) y lleva las cabeceras de helmet', async () => {
    findTableByQrToken.mockResolvedValue(table([]));

    const res = await get();

    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('GET /api/orders/qr/:token: publico y sin pistas', () => {
  it('funciona sin Authorization ni cookies, e ignora un JWT invalido', async () => {
    findTableByQrToken.mockResolvedValue(table([]));

    expect((await get()).status).toBe(200);
    expect((await get(TOKEN, { Authorization: 'Bearer no.es.un.jwt' })).status).toBe(200);
  });

  it('token inexistente y token malformado: el mismo 404, sin eco del token', async () => {
    findTableByQrToken.mockResolvedValue(null);
    const missing = await get();
    const tooLong = 'x'.repeat(300);
    const malformed = await get(tooLong);

    expect(missing.status).toBe(404);
    expect(malformed.status).toBe(404);
    expect(JSON.parse(missing.text).error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Mesa no encontrada',
    });
    expect(JSON.parse(malformed.text).error.code).toBe(JSON.parse(missing.text).error.code);
    expect(JSON.parse(malformed.text).error.message).toBe(JSON.parse(missing.text).error.message);
    expect(missing.text).not.toContain(TOKEN);
    expect(malformed.text).not.toContain(tooLong);
    // El token demasiado largo ni siquiera se consulta
    expect(findTableByQrToken).toHaveBeenCalledTimes(1);
  });

  it('solo lectura: no escribe nada', async () => {
    findTableByQrToken.mockResolvedValue(table([order('ABIERTA')]));

    await get();

    expect(createServiceCall).not.toHaveBeenCalled();
  });

  it('otros metodos sobre la ruta no existen (405/404 del servicio, nunca 200)', async () => {
    findTableByQrToken.mockResolvedValue(table([]));
    const res = await fetch(`${app.base}/api/orders/qr/${TOKEN}`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});
