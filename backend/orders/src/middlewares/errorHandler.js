import { env } from '../config/env.js';

// Express exige los 4 parametros para reconocer un manejador de errores
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = err.status ?? err.statusCode ?? 500;
  const isClientError = status >= 400 && status < 500;
  if (!isClientError) console.error(err);

  const details = {};
  if (env.nodeEnv !== 'production' && err.stack) details.stack = err.stack;

  res.status(isClientError ? status : 500).json({
    error: {
      code: isClientError ? 'BAD_REQUEST' : 'INTERNAL_ERROR',
      message: isClientError ? err.message : 'Error interno del servidor',
      details,
    },
  });
}
