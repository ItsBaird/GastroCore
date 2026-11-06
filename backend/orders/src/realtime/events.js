import { ROOM_KITCHEN, waiterRoom } from './rooms.js';

let ioInstance = null;

export function setIo(io) {
  ioInstance = io;
}

export function getIo() {
  if (!ioInstance) throw new Error('Socket.io no inicializado');
  return ioInstance;
}

export function emitTableStatusChanged(tableStatus) {
  const io = getIo();
  io.to('waiters').emit('table:status_changed', tableStatus);
}

export function emitRoundCreated(kitchenRound) {
  const io = getIo();
  io.to('kitchen').emit('round:created', kitchenRound);
}

// Cambio de estado de un item a las salas kitchen y waiter:{waiterId} (contrato, /items/{id}/status).
// El contrato nombra el evento y las salas pero no esquematiza el payload: enviamos el Item del
// contrato mas orderId y tableNumber para que cocina y el mesero puedan ubicarlo.
export function emitItemStatusChanged({ item, orderId, tableNumber, waiterId }) {
  const io = getIo();
  const payload = { ...item, orderId, tableNumber };
  io.to(ROOM_KITCHEN).emit('item:status_changed', payload);
  io.to(waiterRoom(waiterId)).emit('item:status_changed', payload);
}
