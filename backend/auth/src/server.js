import app from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';

const server = app.listen(env.port, () => {
  console.log(`${env.serviceName} escuchando en :${env.port}`);
});

function shutdown(signal) {
  console.log(`${signal} recibido, cerrando...`);
  setTimeout(() => process.exit(1), 10000).unref();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
