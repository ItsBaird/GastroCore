import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';

// Express exige los 4 parametros para reconocer un manejador de errores
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Error interno del servidor';
  let details = {};

  if (err instanceof AppError) {
    ({ status, code, message, details } = err);
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'JSON mal formado';
  } else {
    console.error(err);
  }

  if (env.nodeEnv === 'development' && err?.stack) {
    details = { ...details, stack: err.stack };
  }

  res.status(status).json({ error: { code, message, details } });
}
