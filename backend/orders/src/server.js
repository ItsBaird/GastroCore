import http from 'node:http';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import app from './app.js';
import { env } from './config/env.js';
import { getPublicKey } from './config/keys.js';
import { prisma } from './config/prisma.js';
import { setIo } from './realtime/events.js';
import { joinRooms } from './realtime/rooms.js';

const ROLES = ['ADMIN', 'WAITER', 'COOK'];

const server = http.createServer(app);
const io = new Server(server);

setIo(io);

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Token requerido'));

  try {
    const payload = jwt.verify(token, getPublicKey(), { algorithms: ['RS256'] });
    if (!payload.sub || !ROLES.includes(payload.role)) {
      return next(new Error('Token invalido'));
    }
    socket.data.user = {
      userId: payload.sub,
      role: payload.role,
      permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
    };
    next();
  } catch {
    next(new Error('Token invalido'));
  }
});

io.on('connection', (socket) => {
  console.log(`[socket.io] conectado: ${socket.id} (${socket.data.user.role})`);
  joinRooms(socket);
  socket.on('disconnect', (reason) => {
    console.log(`[socket.io] desconectado: ${socket.id} (${reason})`);
  });
});

server.listen(env.port, () => {
  console.log(`${env.serviceName} escuchando en :${env.port}`);
});

function shutdown(signal) {
  console.log(`${signal} recibido, cerrando...`);
  setTimeout(() => process.exit(1), 10000).unref();
  io.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
