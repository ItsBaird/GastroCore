import fs from 'node:fs';
import { env } from './env.js';
import { AppError } from '../errors/AppError.js';

// La clave publica se lee una vez y bajo demanda: si falta, el servicio sigue sano y solo
// fallan las peticiones protegidas (RNF-03: las claves nunca viven en el repositorio)
let publicKey;

export function getPublicKey() {
  if (!publicKey) {
    try {
      publicKey = fs.readFileSync(env.jwtPublicKeyPath, 'utf8');
    } catch {
      console.error(
        `No se pudo leer la clave publica JWT en ${env.jwtPublicKeyPath}. Ejecuta scripts/generate-keys.sh`,
      );
      throw new AppError({
        status: 500,
        code: 'INTERNAL_ERROR',
        message: 'Error interno del servidor',
      });
    }
  }
  return publicKey;
}
