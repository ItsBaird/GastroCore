import { getIo } from './events.js';
import { ROOM_WAITERS, waiterRoom } from './rooms.js';

// GC-QR-0002: un cliente llama al mesero desde el QR. El contrato nombra el evento y las salas pero no
// esquematiza el payload: enviamos el ServiceCall del contrato mas el numero de mesa, para que el mesero vea
// "Mesa 4 llama" sin otra consulta (propuesta de contrato: WaiterCalledEvent).
//   - Mesa libre: sala `waiters` (todos los meseros).
//   - Mesa ocupada o en cobro: solo `waiter:{waiterId}`, el mesero de su orden. Una sola emision.
export function emitWaiterCalled({ serviceCall, tableNumber, waiterId }) {
  const io = getIo();
  const room = waiterId ? waiterRoom(waiterId) : ROOM_WAITERS;
  io.to(room).emit('waiter:called', { ...serviceCall, tableNumber });
}

// GC-QR-0004 (GC-147): un cliente pide la cuenta desde el QR. Solo se emite con la mesa ocupada, asi que siempre hay
// mesero asignado: el aviso va unicamente a su sala `waiter:{waiterId}`, nunca a todos. El payload tiene la misma
// forma que waiter:called (el ServiceCall del contrato mas el numero de mesa) para que la pantalla del mesero
// reutilice su manejador (BillRequestedEvent).
export function emitBillRequested({ serviceCall, tableNumber, waiterId }) {
  if (!waiterId) throw new Error('bill:requested necesita el mesero asignado');
  const io = getIo();
  io.to(waiterRoom(waiterId)).emit('bill:requested', { ...serviceCall, tableNumber });
}
