// TRUST_PROXY (despliegue): cuantos proxies hay delante del servicio para leer la IP real del cliente. Se prueba
// cargando env.js y app.js con distintos valores del entorno.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BASE = {
  PORT: '3001',
  SERVICE_NAME: 'auth',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/auth_test',
};

async function loadEnv(extra = {}) {
  vi.resetModules();
  for (const [key, value] of Object.entries({ ...BASE, ...extra })) vi.stubEnv(key, value);
  return (await import('./env.js')).env;
}

beforeEach(() => {
  vi.unstubAllEnvs();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('TRUST_PROXY', () => {
  it('por defecto confia en 1 proxy (nginx en local)', async () => {
    vi.stubEnv('TRUST_PROXY', undefined);
    expect((await loadEnv()).trustProxy).toBe(1);
  });

  it.each([
    ['2', 2],
    ['0', 0],
    [' 3 ', 3],
    ['false', false],
    ['10.0.0.0/8, 172.16.0.0/12', '10.0.0.0/8, 172.16.0.0/12'],
    ['loopback', 'loopback'],
  ])('"%s" -> %j', async (raw, expected) => {
    expect((await loadEnv({ TRUST_PROXY: raw })).trustProxy).toEqual(expected);
  });

  it.each(['true', '', '   '])('"%s" no se acepta: el servicio no arranca', async (raw) => {
    await expect(loadEnv({ TRUST_PROXY: raw })).rejects.toThrow(/TRUST_PROXY/);
  });

  it('app.js usa el valor configurado', async () => {
    await loadEnv({ TRUST_PROXY: '2' });
    const { default: app } = await import('../app.js');
    expect(app.get('trust proxy')).toBe(2);
  });
});
