import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';

const TIMEOUT_MS = 3000; // llamadas entre servicios: 3 s (contrato)

const unavailable = () =>
  new AppError({
    status: 503,
    code: 'DEPENDENCY_UNAVAILABLE',
    message: 'No se pudo verificar el usuario en Auth. Intentalo de nuevo.',
  });

// R1: Auth es dueno de la identidad. Staff comprueba que el userId exista consultando
// GET /api/auth/users/:id con el mismo access token del ADMIN que hace la peticion (no guarda ni
// copia datos de Auth). Devuelve el usuario, o null si no existe.
export async function findAuthUser(userId, authorization) {
  let res;
  try {
    res = await fetch(`${env.authUrl}/api/auth/users/${userId}`, {
      headers: { Authorization: authorization, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw unavailable(); // sin conexion o timeout
  }
  if (res.status === 404) return null;
  if (res.status === 200) return res.json();
  throw unavailable();
}
