// Limite del canal QR publico por IP (GC-163): lo que antes hacia nginx (zona public_qr, 30 por minuto) ahora lo
// hace Orders, porque en produccion (Vercel + Render) no hay nginx. Con la app real y el limite por defecto
// (PUBLIC_RATE_LIMIT=30). La mesa no existe (404): el limite cuenta igual, sin importar la respuesta.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { findTableByQrToken } from '../repositories/serviceCall.repository.js';
import { startApp, tokenFor } from '../test/helpers.js';

vi.mock('../config/prisma.js', () => ({ prisma: {} }));
vi.mock('../repositories/serviceCall.repository.js', () => ({
  findTableByQrToken: vi.fn(),
  createServiceCall: vi.fn(),
}));

const TOKEN = 'Zm9vYmFyYmF6cXV4c29tZXRva2VuMTIzNDU2Nzg5MDEyMw';

let app;
const qr = (ip, path = `/api/orders/qr/${TOKEN}`, method = 'GET') =>
  fetch(`${app.base}${path}`, { method, headers: { 'X-Forwarded-For': ip } }).then(async (res) => ({
    status: res.status,
    headers: res.headers,
    body: await res.json().catch(() => null),
  }));

beforeAll(async () => {
  vi.stubEnv('PUBLIC_RATE_LIMIT', undefined); // el valor de produccion por defecto: 30
  findTableByQrToken.mockResolvedValue(null);
  app = await startApp();
});
afterAll(async () => {
  await app.close();
  vi.unstubAllEnvs();
});

describe('canal QR /api/orders/qr/*: 30 peticiones por minuto por IP', () => {
  it('las 30 primeras pasan y la 31.a responde 429 RATE_LIMITED', async () => {
    for (let i = 0; i < 30; i++) expect((await qr('198.51.100.1')).status).not.toBe(429);
    const blocked = await qr('198.51.100.1');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.body.error.message).toBe(
      'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.',
    );
  });

  it('todas las rutas del canal QR comparten el contador (consultar la mesa y llamar al mesero)', async () => {
    for (let i = 0; i < 30; i++) await qr('198.51.100.2');
    expect((await qr('198.51.100.2', `/api/orders/qr/${TOKEN}/call`, 'POST')).status).toBe(429);
  });

  it('informa el limite en las cabeceras estandar', async () => {
    const res = await qr('198.51.100.3');
    expect(res.headers.get('ratelimit-limit')).toBe('30');
  });

  it('el limite es por IP: otra IP sigue entrando', async () => {
    for (let i = 0; i < 31; i++) await qr('198.51.100.4');
    expect((await qr('198.51.100.5')).status).not.toBe(429);
  });

  it('no afecta las rutas con sesion de Orders desde esa misma IP', async () => {
    for (let i = 0; i < 31; i++) await qr('198.51.100.6');
    const res = await fetch(`${app.base}/api/orders/health`, {
      headers: { 'X-Forwarded-For': '198.51.100.6', Authorization: `Bearer ${tokenFor('ADMIN')}` },
    });
    expect(res.status).toBe(200);
  });
});
