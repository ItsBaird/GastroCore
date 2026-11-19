import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';

const digest = (value) => createHash('sha256').update(value).digest();

// Falla cerrado: sin SERVICE_TOKEN configurado ninguna peticion pasa, en vez de dejar abierta la ruta.
export function requireServiceToken(expected = env.serviceToken) {
  return (req, res, next) => {
    const received = req.get('X-Service-Token') ?? '';
    const valid = expected !== '' && timingSafeEqual(digest(received), digest(expected));
    if (!valid) {
      throw new AppError({
        status: 401,
        code: 'UNAUTHENTICATED',
        message: 'Token de servicio no valido',
      });
    }
    next();
  };
}
