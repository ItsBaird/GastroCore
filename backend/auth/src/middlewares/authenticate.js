// Payload del access token RS256: sub = userId, role y permissions
import jwt from 'jsonwebtoken';
import { getPublicKey } from '../config/keys.js';
import { AppError } from '../errors/AppError.js';

function unauthenticated() {
  return new AppError({ status: 401, code: 'UNAUTHENTICATED', message: 'Sesion no valida' });
}

const JWT_ERRORS = ['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'];

export function authenticate(req, res, next) {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) throw unauthenticated();

  try {
    const payload = jwt.verify(token, getPublicKey(), { algorithms: ['RS256'] });
    req.user = {
      userId: payload.sub,
      role: payload.role,
      permissions: payload.permissions ?? [],
    };
    next();
  } catch (err) {
    if (JWT_ERRORS.includes(err.name)) throw unauthenticated();
    throw err;
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new AppError({
        status: 403,
        code: 'FORBIDDEN',
        message: 'No tienes permiso para esta accion',
      });
    }
    next();
  };
}
