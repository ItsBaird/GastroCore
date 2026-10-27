import http from 'node:http';
import { Server } from 'socket.io';
import app from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';

const server = http.createServer(app);
const io = new Server(server);

io.on('connection', (socket) => {
  console.log(`[socket.io] conectado: ${socket.id}`);
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
