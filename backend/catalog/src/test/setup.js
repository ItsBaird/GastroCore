// Entorno de pruebas: variables que exige config/env.js, un par de claves RSA temporal y una carpeta de fotos temporal.
// Se ejecuta antes de cargar cualquier modulo del servicio. No se usan las claves de ./keys.
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gastrocore-catalog-test-'));
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const publicPath = path.join(dir, 'jwt_public.pem');
const uploadsDir = path.join(dir, 'uploads');
fs.writeFileSync(publicPath, publicKey);

Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: '3003',
  SERVICE_NAME: 'catalog',
  CORS_ORIGIN: 'http://localhost',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/catalog_test',
  JWT_PUBLIC_KEY_PATH: publicPath,
  UPLOADS_DIR: uploadsDir,
  SERVICE_TOKEN: 'token-de-pruebas',
  // Solo para firmar tokens en las pruebas (el servicio real nunca tiene la clave privada)
  TEST_JWT_PRIVATE_KEY: privateKey,
});

process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
