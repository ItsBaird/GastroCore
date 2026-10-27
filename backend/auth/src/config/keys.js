import fs from 'node:fs';
import { env } from './env.js';
import { AppError } from '../errors/AppError.js';

// Las claves se leen una vez y bajo demanda: si faltan, el servicio sigue sano y solo
// fallan las peticiones que las necesitan (RNF-03: nunca viven en el repositorio)
const cache = {};

function readKey(name, path) {
  if (!cache[name]) {
    try {
      cache[name] = fs.readFileSync(path, 'utf8');
    } catch {
      console.error(
        `No se pudo leer la clave JWT (${name}) en ${path}. Ejecuta scripts/generate-keys.sh`,
      );
      throw new AppError({
        status: 500,
        code: 'INTERNAL_ERROR',
        message: 'Error interno del servidor',
      });
    }
  }
  return cache[name];
}

export const getPublicKey = () => readKey('publica', env.jwtPublicKeyPath);
export const getPrivateKey = () => readKey('privada', env.jwtPrivateKeyPath);
