// Opciones del servidor de Socket.io. En produccion el frontend esta en Vercel y el socket va DIRECTO a Orders en
// Render (Vercel no reenvia websockets), asi que es una conexion de otro origen: CORS_ORIGIN (la URL de Vercel) es
// el unico origen permitido. En local el socket llega por el mismo origen (nginx) y esto no cambia nada.
// El socket se autentica con el access token del handshake (no con cookies), asi que otra pagina no puede
// conectarse en nombre del usuario aunque lo intente.
export function socketOptions(env) {
  return {
    cors: { origin: env.corsOrigin, methods: ['GET', 'POST'] },
  };
}
