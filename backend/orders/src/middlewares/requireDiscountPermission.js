import { AppError } from '../errors/AppError.js';

// GC-ORD-0007 (contrato aprobado): aplica descuentos quien trae `discount:apply` en el JWT. El ADMIN puede
// aunque su token no lo traiga (en el MVP nadie tiene el permiso asignado). Que el WAITER sea el mesero
// asignado lo decide el servicio, como en el resto de rutas de la mesa.
export function requireDiscountPermission(req, res, next) {
  const { role, permissions = [] } = req.user ?? {};
  if (role === 'ADMIN' || permissions.includes('discount:apply')) return next();
  throw new AppError({
    status: 403,
    code: 'FORBIDDEN',
    message: 'No tienes permiso para aplicar descuentos',
  });
}
