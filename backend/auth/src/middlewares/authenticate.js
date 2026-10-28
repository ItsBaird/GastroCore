import jwt from 'jsonwebtoken';
import { getPublicKey } from '../config/keys.js';
import { AppError } from '../errors/AppError.js';

// Cada servicio valida el access token JWT RS256 localmente con la clave publica (SAD).
// Payload: sub = userId, role y permissions. Deja el usuario en req.user.
const ROLES = ['ADMIN', 'WAITER', 'COOK'];
const JWT_ERRORS = ['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'];

function unauthenticated() {
  return new AppError({ status: 401, code: 'UNAUTHENTICATED', message: 'Sesion no valida' });
}

function forbidden() {
  return new AppError({
    status: 403,
    code: 'FORBIDDEN',
    message: 'No tienes permiso para esta accion',
  });
}

export function authenticate(req, res, next) {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) throw unauthenticated();

  let payload;
  try {
    payload = jwt.verify(token, getPublicKey(), { algorithms: ['RS256'] });
  } catch (err) {
    if (JWT_ERRORS.includes(err.name)) throw unauthenticated();
    throw err;
  }

  if (!payload.sub || !ROLES.includes(payload.role)) throw unauthenticated();
  req.user = {
    userId: payload.sub,
    role: payload.role,
    permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
  };
  next();
}

// Uso: router.post('/x', authenticate, requireRole('WAITER', 'ADMIN'), handler)
// Donde la documentacion dice WAITER, tambien puede el ADMIN: se pasa explicito.
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) throw forbidden();
    next();
  };
}

// Permisos finos que viajan en el JWT, por ejemplo requirePermission('discount:apply')
export function requirePermission(code) {
  return (req, res, next) => {
    if (!req.user || !req.user.permissions.includes(code)) throw forbidden();
    next();
  };
}
