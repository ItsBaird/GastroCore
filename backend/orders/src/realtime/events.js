import { ROOM_KITCHEN, ROOM_WAITERS, waiterRoom } from './rooms.js';

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

// Una sola emision a varias salas: Socket.io entrega una vez aunque un socket este en mas de una
export function emitTableReassigned(tableStatus, { previousWaiterId, newWaiterId }) {
  const io = getIo();
  io.to([ROOM_WAITERS, waiterRoom(previousWaiterId), waiterRoom(newWaiterId)]).emit(
    'table:status_changed',
    tableStatus,
  );
}

export function emitRoundCreated(kitchenRound) {
  const io = getIo();
  io.to('kitchen').emit('round:created', kitchenRound);
}

// Cambio de estado de un item a las salas kitchen y waiter:{waiterId} (contrato, /items/{id}/status).
// El contrato nombra el evento y las salas pero no esquematiza el payload: enviamos el Item del
// contrato mas orderId y tableNumber para que cocina y el mesero puedan ubicarlo.
// Una sola emision: un ADMIN asignado a la mesa esta en ambas salas y no debe recibirlo dos veces.
export function emitItemStatusChanged({ item, orderId, tableNumber, waiterId }) {
  const io = getIo();
  io.to([ROOM_KITCHEN, waiterRoom(waiterId)]).emit('item:status_changed', {
    ...item,
    orderId,
    tableNumber,
  });
}

// GC-ORD-0007: cambio el descuento de una orden en cobro. Va al mesero actual; solo avisa, la cuenta se
// vuelve a pedir con GET /bill (payload OrderUpdatedEvent del contrato).
export function emitOrderUpdated(payload, waiterId) {
  const io = getIo();
  io.to(waiterRoom(waiterId)).emit('order:updated', payload);
}
