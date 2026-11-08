import { AppError } from '../errors/AppError.js';
import { findTableByQrToken } from '../repositories/serviceCall.repository.js';

// El token de la mesa mide 43 caracteres (32 bytes en base64url) y la columna admite 255: un valor mas largo
// no puede existir, asi que ni se consulta.
export const MAX_TOKEN_LENGTH = 255;

export const tableNotFound = () =>
  new AppError({ status: 404, code: 'NOT_FOUND', message: 'Mesa no encontrada' });

// Canal QR publico: la unica credencial es el token de la mesa. Devuelve la mesa y su orden sin cerrar
// (`order` es null si la mesa esta libre; con orden puede estar ABIERTA o EN_COBRO).
// Un token desconocido o malformado responde siempre lo mismo (404), sin pistas de por que.
export async function resolveQrTable(qrToken) {
  if (typeof qrToken !== 'string' || qrToken.length === 0 || qrToken.length > MAX_TOKEN_LENGTH) {
    throw tableNotFound();
  }

  const table = await findTableByQrToken(qrToken);
  if (!table) throw tableNotFound();

  return { tableId: table.tableId, tableNumber: table.tableNumber, order: table.orders[0] ?? null };
}
