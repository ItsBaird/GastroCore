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
