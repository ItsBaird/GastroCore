import { AppError } from '../errors/AppError.js';
import { toServiceCall } from '../mappers/serviceCall.mapper.js';
import { emitTableStatusChanged } from '../realtime/events.js';
import {
  findServiceCallForAttend,
  markServiceCallAttended,
} from '../repositories/serviceCall.repository.js';
import { getTableStatus } from './tableStatus.service.js';

const alreadyAttended = () =>
  new AppError({
    status: 409,
    code: 'INVALID_TRANSITION',
    message: 'El llamado ya fue atendido',
  });

// El mesero marca como atendido un llamado pendiente (call_waiter o request_bill). Quien puede:
//   - el mesero asignado a la orden abierta de la mesa, o el ADMIN;
//   - con la mesa libre (sin orden) cualquier mesero: igual que el aviso va a toda la sala `waiters`.
// Es la unica forma de cerrar un llamado con la mesa ocupada o en cobro; con la mesa libre tambien se cierra al
// abrirla, y todos se cierran al pagar. Sin esto el cliente no podria volver a llamar en toda la visita.
export async function attendServiceCall(serviceCallId, user) {
  const call = await findServiceCallForAttend(serviceCallId);
  if (!call) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'El llamado no existe' });
  }

  const order = call.table.orders[0] ?? null;
  if (user.role === 'WAITER' && order && order.waiterId !== user.userId) {
    throw new AppError({
      status: 403,
      code: 'FORBIDDEN',
      message: 'No tienes asignada esta mesa',
    });
  }
  if (call.status !== 'pendiente') throw alreadyAttended();

  const attended = await markServiceCallAttended({ serviceCallId, attendedBy: user.userId });
  if (attended === null) throw alreadyAttended();

  // El llamado ya esta guardado: si falla el aviso en tiempo real no se deshace ni se responde error.
  // El panel de mesas recibe el estado de la mesa ya sin ese llamado en `pendingCalls`.
  try {
    const tableStatus = await getTableStatus(call.tableId);
    if (tableStatus) emitTableStatusChanged(tableStatus);
  } catch (err) {
    console.error('No se pudo emitir table:status_changed al atender un llamado', err);
  }

  return toServiceCall(attended);
}
