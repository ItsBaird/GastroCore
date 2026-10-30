const ROOM_WAITERS = 'waiters';
const ROOM_KITCHEN = 'kitchen';
const waiterRoom = (userId) => `waiter:${userId}`;

export function joinRooms(socket) {
  const { role, userId } = socket.data.user;

  if (role === 'WAITER' || role === 'ADMIN') {
    socket.join(ROOM_WAITERS);
    socket.join(waiterRoom(userId));
  }
  if (role === 'COOK') {
    socket.join(ROOM_KITCHEN);
  }
}

export { ROOM_WAITERS, ROOM_KITCHEN, waiterRoom };
