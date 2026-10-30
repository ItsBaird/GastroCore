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
