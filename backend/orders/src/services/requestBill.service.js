import { AppError } from '../errors/AppError.js';
import { toPublicServiceCall, toServiceCall } from '../mappers/serviceCall.mapper.js';
import { emitBillRequested } from '../realtime/serviceCallEvents.js';
import { createServiceCall } from '../repositories/serviceCall.repository.js';
import { getQrCapabilities } from './qrCapabilities.js';
import { resolveQrTable, tableNotFound } from './qrTable.js';
import { deriveTableStatus } from './tableState.js';

const tableNotOpen = () =>
  new AppError({
    status: 409,
    code: 'TABLE_NOT_OPEN',
    message: 'La mesa todavia no esta abierta: no hay cuenta que pedir',
  });

const alreadyBilling = () =>
  new AppError({
    status: 409,
    code: 'INVALID_TRANSITION',
    message: 'La mesa ya esta en cobro: el mesero ya esta preparando la cuenta',
  });

const billAlreadyRequested = () =>
  new AppError({
    status: 409,
    code: 'CONFLICT',
    message: 'Ya pediste la cuenta: el mesero ya fue avisado',
    details: { type: 'request_bill' },
  });

// GC-QR-0004 (GC-146, GC-147). Endpoint publico: la unica credencial es el token del QR. Solo con la mesa
// OCUPADA (la tabla unica de capacidades del canal QR, qrCapabilities.js):
//   - Mesa libre -> 409 TABLE_NOT_OPEN (no hay cuenta que pedir).
//   - Mesa en cobro -> 409 INVALID_TRANSITION (el mesero ya la esta cobrando).
//   - Ya hay una peticion pendiente -> 409 CONFLICT: lo impide el indice unico de la base (un pendiente por
//     tipo y mesa), asi dos pulsaciones simultaneas no crean dos. Es independiente de un "llamar al mesero".
// El cliente recibe el PublicServiceCall (sin tableId); el mesero asignado recibe `bill:requested` con el
// llamado completo y el numero de mesa. El mesero lo cierra con PUT /service-calls/:id/attend, o se cierra
// solo al pagar.
export async function requestBill(qrToken) {
  const { tableId, tableNumber, order } = await resolveQrTable(qrToken);

  const status = deriveTableStatus(order ? [order] : []);
  if (!getQrCapabilities(status).requestBill) {
    throw status === 'libre' ? tableNotOpen() : alreadyBilling();
  }

  let call;
  try {
    call = await createServiceCall({ tableId, type: 'request_bill' });
  } catch (err) {
    if (err?.code === 'P2002') throw billAlreadyRequested();
    if (err?.code === 'P2003') throw tableNotFound(); // la mesa se borro entre la consulta y el alta
    throw err;
  }

  // El llamado ya esta guardado: si falla el aviso en tiempo real no se deshace ni se responde error.
  // El mesero lo seguira viendo como llamado pendiente al consultar el estado de las mesas.
  try {
    emitBillRequested({ serviceCall: toServiceCall(call), tableNumber, waiterId: order.waiterId });
  } catch (err) {
    console.error('No se pudo emitir bill:requested', err);
  }

  return toPublicServiceCall(call);
}
