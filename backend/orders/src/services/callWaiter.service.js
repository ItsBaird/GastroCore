import { AppError } from '../errors/AppError.js';
import { emitWaiterCalled } from '../realtime/serviceCallEvents.js';
import { createServiceCall, findTableByQrToken } from '../repositories/serviceCall.repository.js';

// El token de la mesa mide 43 caracteres (32 bytes en base64url) y la columna admite 255: un valor mas largo
// no puede existir, asi que ni se consulta.
const MAX_TOKEN_LENGTH = 255;

const tableNotFound = () =>
  new AppError({ status: 404, code: 'NOT_FOUND', message: 'Mesa no encontrada' });

const callAlreadyPending = () =>
  new AppError({
    status: 409,
    code: 'CONFLICT',
    message: 'Ya hay un llamado pendiente para esta mesa',
    details: { type: 'call_waiter' },
  });

// ServiceCall del contrato (sin campos internos)
function toServiceCall(call) {
  return {
    serviceCallId: call.serviceCallId,
    tableId: call.tableId,
    type: call.type,
    status: call.status,
    createdAt: call.createdAt,
    attendedAt: call.attendedAt ?? null,
    attendedBy: call.attendedBy ?? null,
  };
}

// GC-QR-0002. Endpoint publico (el cliente no inicia sesion): la unica credencial es el token del QR.
// El duplicado pendiente lo impide el indice unico de la base; aqui solo se traduce el error. Asi dos
// pulsaciones simultaneas no pueden crear dos llamados.
export async function callWaiter(qrToken) {
  if (typeof qrToken !== 'string' || qrToken.length === 0 || qrToken.length > MAX_TOKEN_LENGTH) {
    throw tableNotFound();
  }

  const table = await findTableByQrToken(qrToken);
  if (!table) throw tableNotFound();

  let call;
  try {
    call = await createServiceCall({ tableId: table.tableId, type: 'call_waiter' });
  } catch (err) {
    if (err?.code === 'P2002') throw callAlreadyPending();
    if (err?.code === 'P2003') throw tableNotFound(); // la mesa se borro entre la consulta y el alta
    throw err;
  }

  const serviceCall = toServiceCall(call);
  // El llamado ya esta guardado: si falla el aviso en tiempo real no se deshace ni se responde error.
  // El mesero lo seguira viendo como llamado pendiente al consultar el estado de las mesas.
  try {
    emitWaiterCalled({
      serviceCall,
      tableNumber: table.tableNumber,
      waiterId: table.orders[0]?.waiterId ?? null,
    });
  } catch (err) {
    console.error('No se pudo emitir waiter:called', err);
  }

  return serviceCall;
}
