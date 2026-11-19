// Turnos (GC-STAFF-0002) con la app real (rutas, validacion, autenticacion, errores).
// Los repositorios van simulados: no hace falta base de datos.
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { employeeRepository } from '../repositories/employee.repository.js';
import { shiftRepository } from '../repositories/shift.repository.js';
import {
  MISSING_ID,
  SHIFT_ID,
  USER_ID,
  call,
  makeEmployee,
  makeShift,
  startApp,
  tokenFor,
} from '../test/helpers.js';

vi.mock('../repositories/employee.repository.js', () => ({
  employeeRepository: { findById: vi.fn() },
}));
vi.mock('../repositories/shift.repository.js', () => ({
  shiftRepository: { findMany: vi.fn(), create: vi.fn() },
}));

let app;
const admin = () => tokenFor('ADMIN');

const VALID = {
  userId: USER_ID,
  scheduledStart: '2026-11-09T08:00:00-05:00',
  scheduledEnd: '2026-11-09T16:00:00-05:00',
};

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  employeeRepository.findById.mockResolvedValue(makeEmployee());
  shiftRepository.create.mockImplementation(async (data) => makeShift(data));
  shiftRepository.findMany.mockResolvedValue([]);
});

describe('acceso', () => {
  it.each([
    ['GET', '/api/staff/shifts'],
    ['POST', '/api/staff/shifts'],
  ])('%s %s sin token -> 401', async (method, path) => {
    const res = await call(app.base, method, path, { body: method === 'POST' ? {} : undefined });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it.each(['WAITER', 'COOK'])('un %s no puede programar turnos -> 403', async (role) => {
    const res = await call(app.base, 'POST', '/api/staff/shifts', {
      token: tokenFor(role),
      body: VALID,
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(shiftRepository.create).not.toHaveBeenCalled();
  });

  it.each(['ADMIN', 'WAITER', 'COOK'])(
    'un %s autenticado puede consultar el horario (contrato)',
    async (role) => {
      const res = await call(app.base, 'GET', '/api/staff/shifts', { token: tokenFor(role) });
      expect(res.status).toBe(200);
    },
  );
});

describe('POST /api/staff/shifts', () => {
  it('programacion exitosa: crea el turno en estado programado con las horas programadas -> 201', async () => {
    const res = await call(app.base, 'POST', '/api/staff/shifts', { token: admin(), body: VALID });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      shiftId: SHIFT_ID,
      userId: USER_ID,
      scheduledStart: '2026-11-09T13:00:00.000Z',
      scheduledEnd: '2026-11-09T21:00:00.000Z',
      actualStart: null,
      actualEnd: null,
      status: 'programado',
    });
    expect(employeeRepository.findById).toHaveBeenCalledWith(USER_ID);
    expect(shiftRepository.create).toHaveBeenCalledWith({
      userId: USER_ID,
      scheduledStart: new Date('2026-11-09T13:00:00Z'),
      scheduledEnd: new Date('2026-11-09T21:00:00Z'),
    });
  });

  it('acepta horas en UTC (Z) y con distintos desfases', async () => {
    const body = {
      ...VALID,
      scheduledStart: '2026-11-09T13:00:00Z',
      scheduledEnd: '2026-11-09T21:00:00.000Z',
    };
    expect(
      (await call(app.base, 'POST', '/api/staff/shifts', { token: admin(), body })).status,
    ).toBe(201);
  });

  it('el cliente no puede fijar el estado ni las horas reales: se ignoran', async () => {
    const body = {
      ...VALID,
      status: 'activo',
      actualStart: '2026-11-09T13:00:00Z',
      shiftId: MISSING_ID,
    };
    const res = await call(app.base, 'POST', '/api/staff/shifts', { token: admin(), body });
    expect(res.status).toBe(201);
    expect(shiftRepository.create.mock.calls[0][0]).toEqual({
      userId: USER_ID,
      scheduledStart: new Date('2026-11-09T13:00:00Z'),
      scheduledEnd: new Date('2026-11-09T21:00:00Z'),
    });
    expect(res.body.status).toBe('programado');
  });

  describe('rango invalido -> 400 indicando que el rango horario no es valido', () => {
    it.each([
      ['fin anterior al inicio', '2026-11-09T16:00:00-05:00', '2026-11-09T08:00:00-05:00'],
      ['fin igual al inicio', '2026-11-09T08:00:00-05:00', '2026-11-09T08:00:00-05:00'],
      ['fin un segundo antes', '2026-11-09T08:00:01-05:00', '2026-11-09T08:00:00-05:00'],
      ['mismo instante con distinto desfase', '2026-11-09T08:00:00-05:00', '2026-11-09T13:00:00Z'],
    ])('%s', async (_name, scheduledStart, scheduledEnd) => {
      const body = { ...VALID, scheduledStart, scheduledEnd };
      const res = await call(app.base, 'POST', '/api/staff/shifts', { token: admin(), body });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.fields).toEqual([
        { path: 'scheduledEnd', message: expect.stringMatching(/rango horario no es valido/) },
      ]);
      expect(employeeRepository.findById).not.toHaveBeenCalled();
      expect(shiftRepository.create).not.toHaveBeenCalled();
    });

    it('un fin un segundo despues del inicio si es valido', async () => {
      const body = { ...VALID, scheduledEnd: '2026-11-09T08:00:01-05:00' };
      expect(
        (await call(app.base, 'POST', '/api/staff/shifts', { token: admin(), body })).status,
      ).toBe(201);
    });
  });

  it('empleado inexistente -> 404 NOT_FOUND y no crea nada', async () => {
    employeeRepository.findById.mockResolvedValue(null);
    const res = await call(app.base, 'POST', '/api/staff/shifts', { token: admin(), body: VALID });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(shiftRepository.create).not.toHaveBeenCalled();
  });

  it('el empleado se borra justo antes del insert (FK P2003) -> 404', async () => {
    shiftRepository.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('x', { code: 'P2003', clientVersion: 'test' }),
    );
    const res = await call(app.base, 'POST', '/api/staff/shifts', { token: admin(), body: VALID });
    expect(res.status).toBe(404);
  });

  it.each([
    ['userId', { userId: 'no-uuid' }],
    ['userId', { userId: undefined }],
    ['scheduledStart', { scheduledStart: undefined }],
    ['scheduledStart', { scheduledStart: '2026-11-09 08:00' }],
    ['scheduledStart', { scheduledStart: '2026-11-09T08:00:00' }], // sin zona horaria
    ['scheduledStart', { scheduledStart: '2026-11-09' }],
    ['scheduledStart', { scheduledStart: 'manana' }],
    ['scheduledStart', { scheduledStart: 1731153600000 }],
    ['scheduledEnd', { scheduledEnd: undefined }],
    ['scheduledEnd', { scheduledEnd: '2026-13-09T16:00:00Z' }],
    ['scheduledEnd', { scheduledEnd: '' }],
  ])('rechaza %s invalido %j -> 400', async (field, change) => {
    const body = { ...VALID, ...change };
    const res = await call(app.base, 'POST', '/api/staff/shifts', { token: admin(), body });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields.map((f) => f.path)).toContain(field);
    expect(shiftRepository.create).not.toHaveBeenCalled();
  });

  it('cuerpo vacio -> 400', async () => {
    const res = await call(app.base, 'POST', '/api/staff/shifts', { token: admin(), body: {} });
    expect(res.status).toBe(400);
  });

  it('JSON mal formado -> 400', async () => {
    const res = await call(app.base, 'POST', '/api/staff/shifts', {
      token: admin(),
      rawBody: '{x',
    });
    expect(res.status).toBe(400);
  });

  it('error inesperado de la base -> 500 sin filtrar detalles', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    shiftRepository.create.mockRejectedValue(new Error('password=secreto'));
    const res = await call(app.base, 'POST', '/api/staff/shifts', { token: admin(), body: VALID });
    expect(res.status).toBe(500);
    expect(res.text).not.toContain('secreto');
    spy.mockRestore();
  });
});

describe('GET /api/staff/shifts', () => {
  const get = (query = '') =>
    call(app.base, 'GET', `/api/staff/shifts${query}`, { token: admin() });

  it('devuelve los turnos en formato del contrato (sin fechas internas)', async () => {
    shiftRepository.findMany.mockResolvedValue([makeShift()]);
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        shiftId: SHIFT_ID,
        userId: USER_ID,
        scheduledStart: '2026-11-09T13:00:00.000Z',
        scheduledEnd: '2026-11-09T21:00:00.000Z',
        actualStart: null,
        actualEnd: null,
        status: 'programado',
      },
    ]);
  });

  it('sin filtros consulta todo; sin turnos devuelve []', async () => {
    const res = await get();
    expect(res.body).toEqual([]);
    expect(shiftRepository.findMany).toHaveBeenCalledWith({
      userId: undefined,
      from: undefined,
      to: undefined,
    });
  });

  it('por semana: cualquier dia de la semana da el mismo rango lunes-domingo (hora Colombia)', async () => {
    for (const day of ['2026-11-02', '2026-11-06', '2026-11-08']) {
      shiftRepository.findMany.mockClear();
      await get(`?week=${day}`);
      expect(shiftRepository.findMany).toHaveBeenCalledWith({
        userId: undefined,
        from: new Date('2026-11-02T05:00:00Z'),
        to: new Date('2026-11-09T05:00:00Z'),
      });
    }
  });

  it('por empleado', async () => {
    await get(`?userId=${USER_ID}`);
    expect(shiftRepository.findMany).toHaveBeenCalledWith({
      userId: USER_ID,
      from: undefined,
      to: undefined,
    });
  });

  it('por semana y empleado a la vez', async () => {
    await get(`?week=2026-11-09&userId=${USER_ID}`);
    expect(shiftRepository.findMany).toHaveBeenCalledWith({
      userId: USER_ID,
      from: new Date('2026-11-09T05:00:00Z'),
      to: new Date('2026-11-16T05:00:00Z'),
    });
  });

  it.each([
    '?week=09-11-2026',
    '?week=2026-02-31',
    '?week=hoy',
    '?week=',
    '?userId=123',
    `?week=2026-11-09T10:00:00Z`,
  ])('filtro invalido %s -> 400', async (query) => {
    const res = await get(query);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(shiftRepository.findMany).not.toHaveBeenCalled();
  });
});
