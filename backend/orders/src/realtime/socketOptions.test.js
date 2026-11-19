// Socket.io con la configuracion real (socketOptions) sobre un servidor HTTP real: el handshake que hace un
// navegador desde Vercel (otro origen) recibe el permiso CORS de CORS_ORIGIN.
import http from 'node:http';
import { Server } from 'socket.io';
import { afterEach, describe, expect, it } from 'vitest';
import { socketOptions } from './socketOptions.js';

const VERCEL = 'https://gastrocore.vercel.app';
let server;
let io;

async function start(corsOrigin) {
  server = http.createServer();
  io = new Server(server, socketOptions({ corsOrigin }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

afterEach(async () => {
  io?.close();
  await new Promise((resolve) => (server?.listening ? server.close(resolve) : resolve()));
});

describe('socketOptions', () => {
  it('permite solo CORS_ORIGIN, con GET y POST (los del handshake de Socket.io)', () => {
    expect(socketOptions({ corsOrigin: VERCEL })).toEqual({
      cors: { origin: VERCEL, methods: ['GET', 'POST'] },
    });
  });

  it('el handshake desde el origen de Vercel recibe Access-Control-Allow-Origin de ese origen', async () => {
    const base = await start(VERCEL);
    const res = await fetch(`${base}/socket.io/?EIO=4&transport=polling`, {
      headers: { Origin: VERCEL },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(VERCEL);
  });

  it('el preflight CORS desde Vercel responde con los metodos permitidos', async () => {
    const base = await start(VERCEL);
    const res = await fetch(`${base}/socket.io/?EIO=4&transport=polling`, {
      method: 'OPTIONS',
      headers: { Origin: VERCEL, 'Access-Control-Request-Method': 'POST' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(VERCEL);
    expect(res.headers.get('access-control-allow-methods')).toBe('GET,POST');
  });

  it('otro origen no recibe permiso para el suyo (el navegador bloquea la respuesta)', async () => {
    const base = await start(VERCEL);
    const res = await fetch(`${base}/socket.io/?EIO=4&transport=polling`, {
      headers: { Origin: 'https://sitio-malicioso.example' },
    });
    expect(res.headers.get('access-control-allow-origin')).not.toBe(
      'https://sitio-malicioso.example',
    );
  });
});
