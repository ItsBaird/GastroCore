import jwt from 'jsonwebtoken';

export const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
export const USER_ID = '22222222-2222-4222-8222-222222222222';
export const MISSING_ID = '00000000-0000-4000-8000-000000000000';

// Access token RS256 como el que emite Auth (la clave publica del entorno de pruebas lo valida)
export const tokenFor = (role = 'ADMIN', { userId = ADMIN_ID, permissions = [] } = {}) =>
  jwt.sign({ role, permissions }, process.env.TEST_JWT_PRIVATE_KEY, {
    algorithm: 'RS256',
    subject: userId,
    expiresIn: 900,
  });

// Fila de employees tal como la devuelve Prisma (hire_date es DATE -> Date a medianoche UTC)
export function makeEmployee(overrides = {}) {
  return {
    userId: USER_ID,
    fullName: 'Carlos Rodriguez',
    phone: '3001234567',
    documentNumber: '1012345678',
    position: 'Mesero',
    hireDate: new Date('2026-03-15T00:00:00Z'),
    createdAt: new Date('2026-10-01T10:00:00Z'),
    updatedAt: new Date('2026-10-01T10:00:00Z'),
    ...overrides,
  };
}

export const SHIFT_ID = '66666666-6666-4666-8666-666666666666';

// Fila de shifts tal como la devuelve Prisma (nace 'programado', sin horas reales)
export function makeShift(overrides = {}) {
  return {
    shiftId: SHIFT_ID,
    userId: USER_ID,
    scheduledStart: new Date('2026-11-09T13:00:00Z'),
    scheduledEnd: new Date('2026-11-09T21:00:00Z'),
    actualStart: null,
    actualEnd: null,
    status: 'programado',
    createdAt: new Date('2026-11-01T10:00:00Z'),
    updatedAt: new Date('2026-11-01T10:00:00Z'),
    ...overrides,
  };
}

// Usuario tal como lo devuelve Auth (GET /api/auth/users/:id)
export function makeAuthUser(overrides = {}) {
  return {
    userId: USER_ID,
    email: 'carlos@lapizzeta.co',
    role: 'WAITER',
    isActive: true,
    createdAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

// Levanta la app real (middlewares, rutas, errores) en un puerto libre; los repositorios van simulados
export async function startApp() {
  const { default: app } = await import('../app.js');
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export async function call(base, method, path, { token, body, rawBody } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined || rawBody !== undefined
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // respuesta sin cuerpo JSON
  }
  return { status: res.status, body: json, text, headers: res.headers };
}
