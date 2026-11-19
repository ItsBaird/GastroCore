import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';

const digest = (value) => createHash('sha256').update(value).digest();

// Autenticacion entre servicios en las rutas /internal/*: cabecera X-Service-Token (contrato).
// Falla cerrado: si el servidor no tiene un token configurado (SERVICE_TOKEN vacio) ninguna peticion
// pasa, en vez de dejar la ruta abierta. Se compara en tiempo constante.
// Uso: router.use(requireServiceToken())
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
