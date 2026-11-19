import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const load = () => import('./catalogClient.js');

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('CATALOG_SERVICE_URL', 'http://catalog:3003');
  vi.stubEnv('SERVICE_TOKEN', 'token');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('selección del cliente de catálogo', () => {
  it('usa el mock en desarrollo con CATALOG_CLIENT_MOCK=true', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('CATALOG_CLIENT_MOCK', 'true');

    const { catalogClient } = await load();
    const { catalogClientMock } = await import('./catalogClient.mock.js');

    expect(catalogClient).toBe(catalogClientMock);
  });

  it('usa el cliente HTTP con CATALOG_CLIENT_MOCK=false', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CATALOG_CLIENT_MOCK', 'false');

    const { catalogClient } = await load();
    const { catalogClientHttp } = await import('./catalogClient.http.js');

    expect(catalogClient).toBe(catalogClientHttp);
  });

  it('no arranca en producción con el mock activo', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CATALOG_CLIENT_MOCK', 'true');

    await expect(load()).rejects.toThrow(/CATALOG_CLIENT_MOCK/);
  });

  it('no arranca en producción sin token de servicio', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CATALOG_CLIENT_MOCK', 'false');
    vi.stubEnv('SERVICE_TOKEN', '');

    await expect(load()).rejects.toThrow(/SERVICE_TOKEN/);
  });
});
