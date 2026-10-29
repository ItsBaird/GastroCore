import argon2 from 'argon2';
import fs from 'node:fs';
import { ARGON2_OPTIONS } from '../config/argon2.js';
import { signAccessToken } from '../services/token.service.js';

export const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
export const USER_ID = '22222222-2222-4222-8222-222222222222';
export const MISSING_ID = '00000000-0000-4000-8000-000000000000';
export const PASSWORD = 'ClaveSegura123';

// El hash argon2id es lento a proposito: se calcula una sola vez por archivo de pruebas
let hashPromise;
export const passwordHash = () => (hashPromise ??= argon2.hash(PASSWORD, ARGON2_OPTIONS));

export function makeUser(overrides = {}) {
  return {
    userId: USER_ID,
    email: 'mesero@lapizzeta.com',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$no-se-usa',
    role: 'WAITER',
    isActive: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    createdAt: new Date('2026-10-01T10:00:00Z'),
    updatedAt: new Date('2026-10-01T10:00:00Z'),
    permissions: [],
    ...overrides,
  };
}

// Access token firmado con la clave privada de pruebas (la misma que valida authenticate)
export const tokenFor = (role = 'ADMIN', { userId = ADMIN_ID, permissions = [] } = {}) =>
  signAccessToken({ userId, role, permissions });

export const publicKeyPem = () => fs.readFileSync(process.env.JWT_PUBLIC_KEY_PATH, 'utf8');

// Levanta la app real (middlewares, rutas, errores) en un puerto libre; los repositorios van simulados
export async function startApp() {
  const { default: app } = await import('../app.js');
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export async function call(base, method, path, { token, body, cookie } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(cookie && { Cookie: `refreshToken=${cookie}` }),
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // respuesta sin cuerpo JSON
  }
  return {
    status: res.status,
    body: json,
    text,
    headers: res.headers,
    cookies: res.headers.getSetCookie(),
  };
}
