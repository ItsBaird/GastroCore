import { AppError } from '../errors/AppError.js';

const STAFF_URL = process.env.STAFF_SERVICE_URL || 'http://staff:3002';
const SERVICE_TOKEN = process.env.SERVICE_TOKEN || '';
const TIMEOUT_MS = 3000;

function fetchInternal(path) {
  return fetch(`${STAFF_URL}${path}`, {
    headers: { 'X-Service-Token': SERVICE_TOKEN },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

const unavailable = () =>
  new AppError({
    status: 503,
    code: 'DEPENDENCY_UNAVAILABLE',
    message: 'No se pudo verificar el turno. Inténtalo de nuevo.',
  });

export const staffClient = {
  // Si Staff no responde no se puede afirmar que haya turno, asi que no se abre la mesa (503)
  async hasActiveShift(userId) {
    let body;
    try {
      const res = await fetchInternal(`/internal/shifts/active/${encodeURIComponent(userId)}`);
      if (!res.ok) throw unavailable();
      body = await res.json();
    } catch {
      throw unavailable();
    }
    return body?.active === true;
  },

  // El nombre es informativo: si Staff falla, el panel de mesas sigue funcionando sin nombres
  async getEmployeeNames(userIds) {
    if (userIds.length === 0) return new Map();
    try {
      const res = await fetchInternal(`/internal/employees?ids=${userIds.join(',')}`);
      if (!res.ok) return new Map();
      const employees = await res.json();
      return new Map(employees.map((e) => [e.userId, e.fullName]));
    } catch {
      return new Map();
    }
  },
};
