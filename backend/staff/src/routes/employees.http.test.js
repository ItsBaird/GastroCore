// Empleados (GC-STAFF-0001) con la app real (rutas, validacion, autenticacion, errores).
// Simulados: el repositorio (sin base de datos) y la consulta a Auth (fetch al servicio).
import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { employeeRepository } from '../repositories/employee.repository.js';
import {
  MISSING_ID,
  USER_ID,
  call,
  makeAuthUser,
  makeEmployee,
  startApp,
  tokenFor,
} from '../test/helpers.js';

vi.mock('../repositories/employee.repository.js', () => ({
  employeeRepository: { findAll: vi.fn(), findById: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

let app;
const admin = () => tokenFor('ADMIN');
const prismaError = (code, target) =>
  new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'test', meta: { target } });

const VALID = {
  userId: USER_ID,
  fullName: 'Carlos Rodriguez',
  phone: '3001234567',
  documentNumber: '1012345678',
  position: 'Mesero',
  hireDate: '2026-03-15',
};

// Intercepta solo las llamadas a Auth; el resto de fetch (el de las pruebas a la app) pasa tal cual
const realFetch = globalThis.fetch;
let authCalls;
function mockAuth(handler) {
  authCalls = [];
  globalThis.fetch = vi.fn((url, init) => {
    if (String(url).includes('/api/auth/users/')) {
      authCalls.push({ url: String(url), init });
      return handler();
    }
    return realFetch(url, init);
  });
}
const authReplies =
  (status, body = {}) =>
  () =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  mockAuth(authReplies(200, makeAuthUser()));
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('acceso', () => {
  it.each([
    ['GET', '/api/staff/employees'],
    ['POST', '/api/staff/employees'],
    ['GET', `/api/staff/employees/${USER_ID}`],
    ['PUT', `/api/staff/employees/${USER_ID}`],
  ])('%s %s sin token -> 401', async (method, path) => {
    const res = await call(app.base, method, path, { body: method === 'GET' ? undefined : {} });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it.each(['WAITER', 'COOK'])(
    'un %s no puede usar los endpoints de empleados -> 403',
    async (role) => {
      const token = tokenFor(role);
      for (const [method, path] of [
        ['GET', '/api/staff/employees'],
        ['POST', '/api/staff/employees'],
        ['GET', `/api/staff/employees/${USER_ID}`],
        ['PUT', `/api/staff/employees/${USER_ID}`],
      ]) {
        const res = await call(app.base, method, path, {
          token,
          body: method === 'GET' ? undefined : VALID,
        });
        expect(res.status, `${method} ${path}`).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
      expect(employeeRepository.create).not.toHaveBeenCalled();
    },
  );

  it('el contrato no define DELETE: no existe', async () => {
    const res = await call(app.base, 'DELETE', `/api/staff/employees/${USER_ID}`, {
      token: admin(),
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/staff/employees', () => {
  it('lista los empleados con la fecha de ingreso como AAAA-MM-DD', async () => {
    employeeRepository.findAll.mockResolvedValue([makeEmployee()]);
    const res = await call(app.base, 'GET', '/api/staff/employees', { token: admin() });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        userId: USER_ID,
        fullName: 'Carlos Rodriguez',
        phone: '3001234567',
        documentNumber: '1012345678',
        position: 'Mesero',
        hireDate: '2026-03-15',
        createdAt: '2026-10-01T10:00:00.000Z',
        updatedAt: '2026-10-01T10:00:00.000Z',
      },
    ]);
  });

  it('sin empleados -> []', async () => {
    employeeRepository.findAll.mockResolvedValue([]);
    const res = await call(app.base, 'GET', '/api/staff/employees', { token: admin() });
    expect(res.body).toEqual([]);
  });
});

describe('GET /api/staff/employees/:userId', () => {
  it('devuelve el empleado', async () => {
    employeeRepository.findById.mockResolvedValue(makeEmployee());
    const res = await call(app.base, 'GET', `/api/staff/employees/${USER_ID}`, { token: admin() });
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(USER_ID);
  });

  it('inexistente -> 404 NOT_FOUND', async () => {
    employeeRepository.findById.mockResolvedValue(null);
    const res = await call(app.base, 'GET', `/api/staff/employees/${MISSING_ID}`, {
      token: admin(),
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('id que no es UUID -> 400', async () => {
    const res = await call(app.base, 'GET', '/api/staff/employees/123', { token: admin() });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/staff/employees', () => {
  it('registro exitoso: verifica el userId en Auth con el token del ADMIN y crea el perfil -> 201', async () => {
    employeeRepository.create.mockImplementation(async (data) => makeEmployee(data));
    const token = admin();
    const res = await call(app.base, 'POST', '/api/staff/employees', { token, body: VALID });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      userId: USER_ID,
      fullName: 'Carlos Rodriguez',
      hireDate: '2026-03-15',
    });
    expect(authCalls).toHaveLength(1);
    expect(authCalls[0].url).toMatch(new RegExp(`/api/auth/users/${USER_ID}$`));
    expect(authCalls[0].init.headers.Authorization).toBe(`Bearer ${token}`);
    const saved = employeeRepository.create.mock.calls[0][0];
    expect(saved.hireDate).toEqual(new Date('2026-03-15T00:00:00Z'));
    expect(saved.userId).toBe(USER_ID);
  });

  it('el telefono es opcional y vacio se guarda como null; recorta espacios', async () => {
    employeeRepository.create.mockImplementation(async (data) => makeEmployee(data));
    const body = { ...VALID, fullName: '  Ana Martinez ', phone: '   ', position: ' Cocinera ' };
    const res = await call(app.base, 'POST', '/api/staff/employees', { token: admin(), body });
    expect(res.status).toBe(201);
    expect(employeeRepository.create.mock.calls[0][0]).toMatchObject({
      fullName: 'Ana Martinez',
      phone: null,
      position: 'Cocinera',
    });
    const noPhone = { ...VALID };
    delete noPhone.phone;
    await call(app.base, 'POST', '/api/staff/employees', { token: admin(), body: noPhone });
    expect(employeeRepository.create.mock.calls[1][0]).not.toHaveProperty('phone');
  });

  it('documento duplicado -> 409 CONFLICT indicando que el documento ya existe', async () => {
    employeeRepository.create.mockRejectedValue(prismaError('P2002', ['document_number']));
    const res = await call(app.base, 'POST', '/api/staff/employees', {
      token: admin(),
      body: VALID,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.message).toMatch(/documento ya existe/);
    expect(res.body.error.details).toEqual({ field: 'documentNumber' });
  });

  it('el usuario ya tiene perfil (PK repetida) -> 409 sobre userId', async () => {
    employeeRepository.create.mockRejectedValue(prismaError('P2002', ['user_id']));
    const res = await call(app.base, 'POST', '/api/staff/employees', {
      token: admin(),
      body: VALID,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ field: 'userId' });
  });

  it('userId que no existe en Auth -> 400 sobre userId y no crea nada', async () => {
    mockAuth(authReplies(404, { error: { code: 'NOT_FOUND' } }));
    const res = await call(app.base, 'POST', '/api/staff/employees', {
      token: admin(),
      body: VALID,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields).toEqual([
      { path: 'userId', message: 'El usuario no existe en Auth' },
    ]);
    expect(employeeRepository.create).not.toHaveBeenCalled();
  });

  it.each([
    ['Auth responde 500', () => authReplies(500)],
    ['Auth responde 401', () => authReplies(401)],
    [
      'Auth no responde (conexion rechazada)',
      () => () => Promise.reject(new TypeError('fetch failed')),
    ],
  ])('%s -> 503 DEPENDENCY_UNAVAILABLE y no crea nada', async (_name, make) => {
    mockAuth(make());
    const res = await call(app.base, 'POST', '/api/staff/employees', {
      token: admin(),
      body: VALID,
    });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(employeeRepository.create).not.toHaveBeenCalled();
  });

  it('un cuerpo invalido no llega a consultar Auth', async () => {
    const res = await call(app.base, 'POST', '/api/staff/employees', { token: admin(), body: {} });
    expect(res.status).toBe(400);
    expect(authCalls).toHaveLength(0);
  });

  it.each([
    ['userId', { userId: 'no-uuid' }],
    ['userId', { userId: undefined }],
    ['fullName', { fullName: '   ' }],
    ['fullName', { fullName: 'x'.repeat(151) }],
    ['documentNumber', { documentNumber: '' }],
    ['documentNumber', { documentNumber: '9'.repeat(31) }],
    ['position', { position: '' }],
    ['position', { position: 'x'.repeat(51) }],
    ['phone', { phone: '3'.repeat(31) }],
    ['hireDate', { hireDate: '15/03/2026' }],
    ['hireDate', { hireDate: '2026-02-31' }],
    ['hireDate', { hireDate: '2026-13-01' }],
    ['hireDate', { hireDate: undefined }],
  ])('rechaza %s invalido %j -> 400', async (field, change) => {
    const body = { ...VALID, ...change };
    const res = await call(app.base, 'POST', '/api/staff/employees', { token: admin(), body });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields.map((f) => f.path)).toContain(field);
    expect(employeeRepository.create).not.toHaveBeenCalled();
  });

  it('JSON mal formado -> 400', async () => {
    const res = await call(app.base, 'POST', '/api/staff/employees', {
      token: admin(),
      rawBody: '{x',
    });
    expect(res.status).toBe(400);
  });

  it('error inesperado de la base -> 500 sin filtrar detalles', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    employeeRepository.create.mockRejectedValue(new Error('password=secreto'));
    const res = await call(app.base, 'POST', '/api/staff/employees', {
      token: admin(),
      body: VALID,
    });
    expect(res.status).toBe(500);
    expect(res.text).not.toContain('secreto');
    spy.mockRestore();
  });
});

describe('PUT /api/staff/employees/:userId', () => {
  const put = (body, id = USER_ID) =>
    call(app.base, 'PUT', `/api/staff/employees/${id}`, { token: admin(), body });

  it('actualiza solo los campos enviados -> 200', async () => {
    employeeRepository.update.mockResolvedValue(makeEmployee({ position: 'Cajero' }));
    const res = await put({ position: 'Cajero' });
    expect(res.status).toBe(200);
    expect(res.body.position).toBe('Cajero');
    expect(employeeRepository.update).toHaveBeenCalledWith(USER_ID, { position: 'Cajero' });
    expect(authCalls).toHaveLength(0);
  });

  it('convierte la fecha de ingreso y permite borrar el telefono con ""', async () => {
    employeeRepository.update.mockResolvedValue(makeEmployee());
    await put({ hireDate: '2026-04-01', phone: '' });
    expect(employeeRepository.update).toHaveBeenCalledWith(USER_ID, {
      hireDate: new Date('2026-04-01T00:00:00Z'),
      phone: null,
    });
  });

  it('el userId del cuerpo se ignora (no se puede cambiar)', async () => {
    employeeRepository.update.mockResolvedValue(makeEmployee());
    await put({ userId: MISSING_ID, position: 'Cajero' });
    expect(employeeRepository.update).toHaveBeenCalledWith(USER_ID, { position: 'Cajero' });
  });

  it('cuerpo vacio -> 400', async () => {
    const res = await put({});
    expect(res.status).toBe(400);
    expect(employeeRepository.update).not.toHaveBeenCalled();
  });

  it('inexistente (P2025) -> 404', async () => {
    employeeRepository.update.mockRejectedValue(prismaError('P2025'));
    const res = await put({ position: 'X' }, MISSING_ID);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('documento de otro empleado (P2002) -> 409', async () => {
    employeeRepository.update.mockRejectedValue(prismaError('P2002', ['document_number']));
    const res = await put({ documentNumber: '999' });
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ field: 'documentNumber' });
  });

  it('valores invalidos -> 400', async () => {
    expect((await put({ hireDate: '2026-02-30' })).status).toBe(400);
    expect((await put({ fullName: '' })).status).toBe(400);
    expect((await put({ position: 'x'.repeat(51) })).status).toBe(400);
    expect((await put({ position: 'Cajero' }, 'no-uuid')).status).toBe(400);
    expect(employeeRepository.update).not.toHaveBeenCalled();
  });
});
