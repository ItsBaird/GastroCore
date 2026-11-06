import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { USER_ID } from '../test/helpers.js';
import { findOpenTables } from './orders.client.js';

const realFetch = globalThis.fetch;
const reply = (status, body = {}) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

async function expectUnavailable(promise) {
  const err = await promise.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect({ status: err.status, code: err.code }).toEqual({
    status: 503,
    code: 'DEPENDENCY_UNAVAILABLE',
  });
}

beforeEach(() => {
  globalThis.fetch = vi.fn();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('findOpenTables', () => {
  it('consulta GET /internal/tables/open?waiterId= en la URL interna de Orders con el token de servicio', async () => {
    globalThis.fetch.mockReturnValue(reply(200, { count: 0 }));
    await findOpenTables(USER_ID);
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe(`${env.ordersUrl}/internal/tables/open?waiterId=${USER_ID}`);
    expect(init.headers['X-Service-Token']).toBe('token-de-pruebas');
  });

  it('usa la URL interna de la red de Docker por defecto (sin pasar por el gateway)', () => {
    expect(env.ordersUrl).toBe('http://orders:3004');
  });

  it('pone un timeout de 3 s a la llamada', async () => {
    globalThis.fetch.mockReturnValue(reply(200, { count: 0 }));
    const spy = vi.spyOn(AbortSignal, 'timeout');
    await findOpenTables(USER_ID);
    expect(spy).toHaveBeenCalledWith(3000);
    expect(globalThis.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    spy.mockRestore();
  });

  it('devuelve el conteo y las mesas', async () => {
    globalThis.fetch.mockReturnValue(
      reply(200, { count: 2, tables: [{ tableId: 'a' }, { tableId: 'b' }] }),
    );
    expect(await findOpenTables(USER_ID)).toEqual({
      count: 2,
      tables: [{ tableId: 'a' }, { tableId: 'b' }],
    });
  });

  it('sin lista de mesas devuelve un arreglo vacio', async () => {
    globalThis.fetch.mockReturnValue(reply(200, { count: 0 }));
    expect(await findOpenTables(USER_ID)).toEqual({ count: 0, tables: [] });
  });

  it.each([401, 403, 404, 429, 500, 502])(
    'Orders responde %i -> 503 DEPENDENCY_UNAVAILABLE',
    async (status) => {
      globalThis.fetch.mockReturnValue(reply(status));
      await expectUnavailable(findOpenTables(USER_ID));
    },
  );

  it.each([
    ['sin count', {}],
    ['count texto', { count: '1' }],
    ['count decimal', { count: 1.5 }],
    ['count negativo', { count: -1 }],
    ['cuerpo null', null],
  ])('respuesta 200 invalida (%s) -> 503', async (_name, body) => {
    globalThis.fetch.mockReturnValue(reply(200, body));
    await expectUnavailable(findOpenTables(USER_ID));
  });

  it('respuesta 200 que no es JSON -> 503', async () => {
    globalThis.fetch.mockResolvedValue(new Response('<html>', { status: 200 }));
    await expectUnavailable(findOpenTables(USER_ID));
  });

  it('conexion rechazada y timeout -> 503', async () => {
    globalThis.fetch.mockRejectedValue(new TypeError('fetch failed'));
    await expectUnavailable(findOpenTables(USER_ID));
    globalThis.fetch.mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    await expectUnavailable(findOpenTables(USER_ID));
  });
});
