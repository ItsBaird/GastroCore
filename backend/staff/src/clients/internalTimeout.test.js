// INTERNAL_TIMEOUT_MS (despliegue): la espera de las llamadas de Staff a Auth y Orders. Por defecto 3 s (contrato);
// en Render gratis se sube porque un servicio dormido tarda en despertar.
import { afterEach, describe, expect, it, vi } from 'vitest';

const USER_ID = '22222222-2222-4222-8222-222222222222';

async function loadClients(timeout) {
  vi.resetModules();
  if (timeout !== undefined) vi.stubEnv('INTERNAL_TIMEOUT_MS', timeout);
  const { findAuthUser } = await import('./auth.client.js');
  const { findOpenTables } = await import('./orders.client.js');
  return { findAuthUser, findOpenTables };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('INTERNAL_TIMEOUT_MS en los clientes de Staff', () => {
  it.each([
    [undefined, 3000],
    ['60000', 60000],
  ])('con %s las dos llamadas esperan %i ms', async (raw, expected) => {
    const { findAuthUser, findOpenTables } = await loadClients(raw);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ count: 0, tables: [] }), { status: 200 })),
    );
    const spy = vi.spyOn(AbortSignal, 'timeout');

    await findOpenTables(USER_ID);
    await findAuthUser(USER_ID, 'Bearer x').catch(() => {});

    expect(spy.mock.calls.map((c) => c[0])).toEqual([expected, expected]);
  });

  it.each(['abc', '100', '200000', '1.5'])(
    'un valor invalido (%s) detiene el arranque',
    async (raw) => {
      await expect(loadClients(raw)).rejects.toThrow(/INTERNAL_TIMEOUT_MS/);
    },
  );
});
