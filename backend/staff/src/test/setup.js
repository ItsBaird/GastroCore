// Entorno de pruebas: variables que exige config/env.js, un par de claves RSA temporal y una carpeta de fotos temporal.
// Se ejecuta antes de cargar cualquier modulo del servicio. No se usan las claves de ./keys.
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gastrocore-staff-test-'));
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const publicPath = path.join(dir, 'jwt_public.pem');
fs.writeFileSync(publicPath, publicKey);

Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: '3002',
  SERVICE_NAME: 'staff',
  CORS_ORIGIN: 'http://localhost',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/staff_test',
  JWT_PUBLIC_KEY_PATH: publicPath,
  // Solo para firmar tokens en las pruebas (el servicio real nunca tiene la clave privada)
  TEST_JWT_PRIVATE_KEY: privateKey,
});

process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
