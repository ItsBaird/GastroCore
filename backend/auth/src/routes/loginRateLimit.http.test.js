// Limite de inicio de sesion por IP (GC-162): lo que antes hacia nginx (5 por minuto) ahora lo hace Auth, porque
// en produccion (Vercel + Render) no hay nginx. Con la app real y el limite por defecto (LOGIN_RATE_LIMIT=5).
// Los cuerpos van mal formados a proposito: el limite actua ANTES de validar, asi que cuenta cualquier intento y la
// prueba no necesita base de datos.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { call, startApp } from '../test/helpers.js';

let app;
// Cada prueba usa su propia IP (X-Forwarded-For, con TRUST_PROXY=1) para no compartir el contador
const login = (ip) =>
  fetch(`${app.base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: '{}',
  }).then(async (res) => ({ status: res.status, headers: res.headers, body: await res.json() }));

beforeAll(async () => {
  // helpers.js ya cargo env.js con el valor de pruebas: se recargan los modulos para leer el de produccion
  vi.resetModules();
  vi.stubEnv('LOGIN_RATE_LIMIT', undefined); // el valor de produccion por defecto: 5
  app = await startApp();
});
afterAll(async () => {
  await app.close();
  vi.unstubAllEnvs();
});

describe('POST /api/auth/login: 5 intentos por minuto por IP', () => {
  it('los 5 primeros intentos pasan (aqui 400 por cuerpo invalido) y el 6.o responde 429 RATE_LIMITED', async () => {
    for (let i = 0; i < 5; i++) expect((await login('203.0.113.1')).status).toBe(400);
    const blocked = await login('203.0.113.1');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toEqual({
      code: 'RATE_LIMITED',
      message: 'Demasiados intentos de inicio de sesión. Espera un minuto e inténtalo de nuevo.',
      details: {},
    });
  });

  it('informa el limite y cuanto falta en las cabeceras estandar (RateLimit-*)', async () => {
    const res = await login('203.0.113.2');
    expect(res.headers.get('ratelimit-limit')).toBe('5');
    expect(res.headers.get('ratelimit-remaining')).toBe('4');
  });

  it('el limite es por IP: otra IP sigue pudiendo intentar', async () => {
    for (let i = 0; i < 6; i++) await login('203.0.113.3');
    expect((await login('203.0.113.3')).status).toBe(429);
    expect((await login('203.0.113.4')).status).toBe(400);
  });

  it('solo cuenta el login: otras rutas de Auth desde esa IP no quedan bloqueadas', async () => {
    for (let i = 0; i < 6; i++) await login('203.0.113.5');
    const res = await fetch(`${app.base}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'X-Forwarded-For': '203.0.113.5' },
    });
    expect(res.status).not.toBe(429);
  });

  it('el health del servicio no se ve afectado', async () => {
    expect((await call(app.base, 'GET', '/api/auth/health')).status).toBe(200);
  });
});
