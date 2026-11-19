import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { USER_ID, makeAuthUser } from '../test/helpers.js';
import { findAuthUser } from './auth.client.js';

const realFetch = globalThis.fetch;
const BEARER = 'Bearer token-del-admin';

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

describe('findAuthUser', () => {
  it('consulta GET /api/auth/users/:id en la URL interna de Auth con el token del ADMIN', async () => {
    globalThis.fetch.mockReturnValue(reply(200, makeAuthUser()));
    await findAuthUser(USER_ID, BEARER);
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe(`${env.authUrl}/api/auth/users/${USER_ID}`);
    expect(init.headers.Authorization).toBe(BEARER);
    expect(init.method ?? 'GET').toBe('GET');
  });

  it('usa la URL interna de la red de Docker por defecto (sin pasar por el gateway)', () => {
    expect(env.authUrl).toBe('http://auth:3001');
  });

  it('pone un timeout de 3 s a la llamada', async () => {
    globalThis.fetch.mockReturnValue(reply(200, makeAuthUser()));
    const spy = vi.spyOn(AbortSignal, 'timeout');
    await findAuthUser(USER_ID, BEARER);
    expect(spy).toHaveBeenCalledWith(3000);
    expect(globalThis.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    spy.mockRestore();
  });

  it('200 -> devuelve el usuario de Auth', async () => {
    globalThis.fetch.mockReturnValue(reply(200, makeAuthUser()));
    expect(await findAuthUser(USER_ID, BEARER)).toMatchObject({ userId: USER_ID, role: 'WAITER' });
  });

  it('404 -> null (el usuario no existe)', async () => {
    globalThis.fetch.mockReturnValue(reply(404, { error: { code: 'NOT_FOUND' } }));
    expect(await findAuthUser(USER_ID, BEARER)).toBeNull();
  });

  it.each([401, 403, 429, 500, 502])(
    'Auth responde %i -> 503 DEPENDENCY_UNAVAILABLE',
    async (status) => {
      globalThis.fetch.mockReturnValue(reply(status));
      await expectUnavailable(findAuthUser(USER_ID, BEARER));
    },
  );

  it('conexion rechazada -> 503 DEPENDENCY_UNAVAILABLE', async () => {
    globalThis.fetch.mockRejectedValue(new TypeError('fetch failed'));
    await expectUnavailable(findAuthUser(USER_ID, BEARER));
  });

  it('timeout (TimeoutError) -> 503 DEPENDENCY_UNAVAILABLE', async () => {
    globalThis.fetch.mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    await expectUnavailable(findAuthUser(USER_ID, BEARER));
  });
});
