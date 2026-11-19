import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';

const TIMEOUT_MS = 3000; // llamadas entre servicios: 3 s (contrato)

const unavailable = () =>
  new AppError({
    status: 503,
    code: 'DEPENDENCY_UNAVAILABLE',
    message: 'No se pudo verificar las mesas abiertas en Orders. Intentalo de nuevo.',
  });

// REQ-F02-04: antes de finalizar un turno Staff consulta a Orders (ruta interna, X-Service-Token)
// GET /internal/tables/open?waiterId=<userId>. Devuelve { count, tables }. Si Orders no responde
// bien no se puede afirmar que no haya mesas abiertas, asi que el turno no se finaliza (503).
export async function findOpenTables(userId) {
  let res;
  try {
    res = await fetch(
      `${env.ordersUrl}/internal/tables/open?waiterId=${encodeURIComponent(userId)}`,
      {
        headers: { 'X-Service-Token': env.serviceToken, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
  } catch {
    throw unavailable(); // sin conexion o timeout
  }
  if (res.status !== 200) throw unavailable();

  let body;
  try {
    body = await res.json();
  } catch {
    throw unavailable();
  }
  if (!Number.isInteger(body?.count) || body.count < 0) throw unavailable();
  return { count: body.count, tables: Array.isArray(body.tables) ? body.tables : [] };
}
