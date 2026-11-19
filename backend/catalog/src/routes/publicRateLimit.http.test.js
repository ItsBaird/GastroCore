// Limite del menu publico por IP: lo que antes hacia nginx (zona public_qr, 30 por minuto en /api/catalog/public/)
// ahora lo hace Catalog, porque en produccion (Vercel + Render) no hay nginx. Con la app real y el limite por
// defecto (PUBLIC_RATE_LIMIT=30).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { categoryRepository } from '../repositories/category.repository.js';
import { startApp } from '../test/helpers.js';
import { photoStore } from '../test/photoStore.js';

vi.mock(
  '../repositories/photo.repository.js',
  async () => (await import('../test/photoStore.js')).photoMock,
);
vi.mock('../repositories/category.repository.js', () => ({
  categoryRepository: { findMenu: vi.fn(), findAll: vi.fn(), findById: vi.fn() },
}));

let app;
const get = (ip, path = '/api/catalog/public/menu') =>
  fetch(`${app.base}${path}`, { headers: { 'X-Forwarded-For': ip } }).then(async (res) => ({
    status: res.status,
    headers: res.headers,
    body: await res.json().catch(() => null),
  }));

beforeAll(async () => {
  vi.stubEnv('PUBLIC_RATE_LIMIT', undefined); // el valor de produccion por defecto: 30
  categoryRepository.findMenu.mockResolvedValue([]);
  app = await startApp();
});
afterAll(async () => {
  await app.close();
  vi.unstubAllEnvs();
  photoStore.clear();
});

describe('menu publico /api/catalog/public/*: 30 peticiones por minuto por IP', () => {
  it('las 30 primeras responden el menu y la 31.a responde 429 RATE_LIMITED', async () => {
    for (let i = 0; i < 30; i++) expect((await get('192.0.2.1')).status).toBe(200);
    const blocked = await get('192.0.2.1');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });

  it('el limite es por IP: otra IP sigue viendo el menu', async () => {
    for (let i = 0; i < 31; i++) await get('192.0.2.2');
    expect((await get('192.0.2.3')).status).toBe(200);
  });

  it('las fotos no entran en este limite (como antes: nginx solo limitaba /public/)', async () => {
    photoStore.set('seed-pizza.svg', { mimeType: 'image/svg+xml', content: Buffer.from('<svg/>') });
    for (let i = 0; i < 31; i++) await get('192.0.2.4');
    expect((await get('192.0.2.4', '/api/catalog/photos/seed-pizza.svg')).status).toBe(200);
  });
});
