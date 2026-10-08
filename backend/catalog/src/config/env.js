const required = ['SERVICE_NAME'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  throw new Error(`Faltan variables de entorno: ${missing.join(', ')}`);
}

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error('PORT debe ser un entero positivo');
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port,
  serviceName: process.env.SERVICE_NAME,
};
