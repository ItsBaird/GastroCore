// Entorno de pruebas: variables que exige config/env.js y un par de claves RSA temporal.
// Se ejecuta antes de cargar cualquier modulo del servicio. No se usan las claves de ./keys.
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gastrocore-auth-test-'));
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const publicPath = path.join(dir, 'jwt_public.pem');
const privatePath = path.join(dir, 'jwt_private.pem');
fs.writeFileSync(publicPath, publicKey);
fs.writeFileSync(privatePath, privateKey);

Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: '3001',
  SERVICE_NAME: 'auth',
  CORS_ORIGIN: 'http://localhost',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/auth_test',
  JWT_PUBLIC_KEY_PATH: publicPath,
  JWT_PRIVATE_KEY_PATH: privatePath,
  ACCESS_TOKEN_TTL_SECONDS: '900',
  REFRESH_TOKEN_TTL_DAYS: '7',
  LOGIN_MAX_ATTEMPTS: '5',
  LOGIN_LOCK_MINUTES: '15',
});

process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
