import { AppError } from '../errors/AppError.js';
import { emitWaiterCalled } from '../realtime/serviceCallEvents.js';
import { toServiceCall } from '../mappers/serviceCall.mapper.js';
import { createServiceCall } from '../repositories/serviceCall.repository.js';
import { resolveQrTable, tableNotFound } from './qrTable.js';

const callAlreadyPending = () =>
  new AppError({
    status: 409,
    code: 'CONFLICT',
    message: 'Ya hay un llamado pendiente para esta mesa',
    details: { type: 'call_waiter' },
  });

// GC-QR-0002. Endpoint publico (el cliente no inicia sesion): la unica credencial es el token del QR.
// El duplicado pendiente lo impide el indice unico de la base; aqui solo se traduce el error. Asi dos
// pulsaciones simultaneas no pueden crear dos llamados.
export async function callWaiter(qrToken) {
  const { tableId, tableNumber, order } = await resolveQrTable(qrToken);

  let call;
  try {
    call = await createServiceCall({ tableId, type: 'call_waiter' });
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
      tableNumber,
      waiterId: order?.waiterId ?? null,
    });
  } catch (err) {
    console.error('No se pudo emitir waiter:called', err);
  }

  return serviceCall;
}
