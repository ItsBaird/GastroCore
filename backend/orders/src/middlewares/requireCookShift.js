import { staffClient } from '../clients/staffClient.js';
import { AppError } from '../errors/AppError.js';

// GC-ORD-0004 (contrato aprobado): el COOK opera la cocina solo con turno activo en Staff, igual que el
// mesero al abrir mesa. El ADMIN no lo necesita y no se consulta Staff. Si Staff no responde, el 503 del
// cliente se propaga: sin poder verificar el turno no se opera.
export async function requireCookShift(req, res, next) {
  if (req.user?.role !== 'COOK') return next();
  if (!(await staffClient.hasActiveShift(req.user.userId))) {
    throw new AppError({
      status: 409,
      code: 'NO_ACTIVE_SHIFT',
      message: 'Debes iniciar tu turno para operar la cocina',
    });
  }
  return next();
}
