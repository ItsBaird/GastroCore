const ROOM_WAITERS = 'waiters';
const ROOM_KITCHEN = 'kitchen';
const waiterRoom = (userId) => `waiter:${userId}`;

export function joinRooms(socket) {
  const { role, userId } = socket.data.user;

  if (role === 'WAITER' || role === 'ADMIN') {
    socket.join(ROOM_WAITERS);
    socket.join(waiterRoom(userId));
  }
  // El ADMIN tambien opera la cocina (GET /kitchen y PUT /items/:id/status lo permiten)
  if (role === 'COOK' || role === 'ADMIN') {
    socket.join(ROOM_KITCHEN);
  }
}

export { ROOM_WAITERS, ROOM_KITCHEN, waiterRoom };
