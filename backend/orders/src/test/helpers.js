import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';

// Entorno de pruebas propio de estos tests (no hay setup global en Orders): variables que exige
// config/env.js y un par de claves RSA temporal. Se ejecuta al importar este archivo, antes de cargar la app.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gastrocore-orders-test-'));
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const publicPath = path.join(dir, 'jwt_public.pem');
fs.writeFileSync(publicPath, publicKey);
Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: '3004',
  SERVICE_NAME: 'orders',
  CORS_ORIGIN: 'http://localhost',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/orders_test',
  JWT_PUBLIC_KEY_PATH: publicPath,
});
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));

export const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
export const METHOD_ID = '55555555-5555-4555-8555-555555555555';
export const OTHER_METHOD_ID = '66666666-6666-4666-8666-666666666666';
export const MISSING_ID = '00000000-0000-4000-8000-000000000000';

// Access token RS256 como el que emite Auth (la clave publica del entorno de pruebas lo valida)
export const tokenFor = (role = 'ADMIN', { userId = ADMIN_ID, permissions = [] } = {}) =>
  jwt.sign({ role, permissions }, privateKey, {
    algorithm: 'RS256',
    subject: userId,
    expiresIn: 900,
  });

// Fila de payment_methods tal como la devuelve Prisma
export function makePaymentMethod(overrides = {}) {
  return {
    paymentMethodId: METHOD_ID,
    name: 'Efectivo',
    isCash: true,
    isActive: true,
    createdAt: new Date('2026-10-01T10:00:00Z'),
    ...overrides,
  };
}

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

export async function call(base, method, path, { token, body, rawBody } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined || rawBody !== undefined
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // respuesta sin cuerpo JSON
  }
  return { status: res.status, body: json, text };
}
