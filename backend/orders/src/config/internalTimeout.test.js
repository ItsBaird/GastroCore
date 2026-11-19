// INTERNAL_TIMEOUT_MS (despliegue): la espera de las llamadas de Orders a Staff y Catalog. Por defecto 3 s
// (contrato); en Render gratis se sube porque un servicio dormido tarda en despertar.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_INTERNAL_TIMEOUT_MS, parseInternalTimeout } from './internalTimeout.js';

const USER_ID = '22222222-2222-4222-8222-222222222222';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.resetModules();
});

describe('parseInternalTimeout', () => {
  it('sin valor (o vacio) usa los 3 s del contrato', () => {
    expect(DEFAULT_INTERNAL_TIMEOUT_MS).toBe(3000);
    expect(parseInternalTimeout(undefined)).toBe(3000);
    expect(parseInternalTimeout('  ')).toBe(3000);
  });

  it.each([
    ['500', 500],
    ['60000', 60000],
    ['120000', 120000],
  ])('"%s" -> %i', (raw, expected) => {
    expect(parseInternalTimeout(raw)).toBe(expected);
  });

  it.each(['abc', '499', '120001', '1.5', '-1'])('"%s" no se acepta', (raw) => {
    expect(() => parseInternalTimeout(raw)).toThrow(/INTERNAL_TIMEOUT_MS/);
  });
});

describe('los clientes de Orders usan INTERNAL_TIMEOUT_MS', () => {
  it('staffClient: la consulta del turno espera lo configurado', async () => {
    vi.resetModules();
    vi.stubEnv('INTERNAL_TIMEOUT_MS', '60000');
    const { staffClient } = await import('../clients/staffClient.js');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ active: true }), { status: 200 })),
    );
    const spy = vi.spyOn(AbortSignal, 'timeout');

    await staffClient.hasActiveShift(USER_ID);

    expect(spy).toHaveBeenCalledWith(60000);
  });

  it('catalogClient: aborta justo al cumplirse lo configurado (no antes) y responde 503', async () => {
    vi.resetModules();
    vi.stubEnv('INTERNAL_TIMEOUT_MS', '5000');
    const { catalogClientHttp } = await import('../clients/catalogClient.http.js');
    vi.useFakeTimers();
    let aborted = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              aborted = true;
              reject(new DOMException('abort', 'AbortError'));
            });
          }),
      ),
    );

    const pending = catalogClientHttp.getProductsByIds(['p1']);
    const outcome = pending.catch((err) => err);
    await vi.advanceTimersByTimeAsync(4999);
    expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(aborted).toBe(true);
    expect(await outcome).toMatchObject({ status: 503, code: 'DEPENDENCY_UNAVAILABLE' });
  });
});
