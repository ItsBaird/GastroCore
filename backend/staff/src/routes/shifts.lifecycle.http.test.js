// Inicio y fin de turno (GC-STAFF-0003) con la app real (rutas, validacion, autenticacion, errores).
// Simulados: el repositorio de turnos, la consulta a Orders (fetch) y el reloj (solo Date).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { shiftRepository } from '../repositories/shift.repository.js';
import {
  ADMIN_ID,
  MISSING_ID,
  SHIFT_ID,
  USER_ID,
  call,
  makeShift,
  startApp,
  tokenFor,
} from '../test/helpers.js';

vi.mock('../repositories/shift.repository.js', () => ({
  shiftRepository: { findMany: vi.fn(), create: vi.fn(), findById: vi.fn(), transition: vi.fn() },
}));

let app;
const OTHER_ID = '77777777-7777-4777-8777-777777777777';

// Turno programado de 8:00 a. m. a 4:00 p. m. hora Colombia (13:00Z a 21:00Z)
const START = new Date('2026-11-09T13:00:00Z');
const END = new Date('2026-11-09T21:00:00Z');
const INSIDE = new Date('2026-11-09T15:00:00Z');

const realFetch = globalThis.fetch;
let ordersCalls;
function mockOrders(handler) {
  ordersCalls = [];
  globalThis.fetch = vi.fn((url, init) => {
    if (String(url).includes('/internal/tables/open')) {
      ordersCalls.push({ url: String(url), init });
      return handler();
    }
    return realFetch(url, init);
  });
}
const ordersReplies =
  (status, body = {}) =>
  () =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

// Los tokens se firman despues de fijar la hora simulada (si no, nacerian ya vencidos)
const token = (role = 'WAITER', userId = USER_ID) => tokenFor(role, { userId });
const post = (action, tk, id = SHIFT_ID) =>
  call(app.base, 'POST', `/api/staff/shifts/${id}/${action}`, { token: tk });
const at = (date) => vi.setSystemTime(date);

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  at(INSIDE);
  shiftRepository.findById.mockResolvedValue(
    makeShift({ scheduledStart: START, scheduledEnd: END }),
  );
  shiftRepository.transition.mockImplementation(async (_id, _from, data) =>
    makeShift({ scheduledStart: START, scheduledEnd: END, ...data }),
  );
  mockOrders(ordersReplies(200, { count: 0, tables: [] }));
});
afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = realFetch;
});

describe('acceso', () => {
  it.each(['start', 'end'])('POST /shifts/:id/%s sin token -> 401', async (action) => {
    const res = await post(action, undefined);
    expect(res.status).toBe(401);
  });

  it.each(['start', 'end'])('POST /shifts/:id/%s con id que no es UUID -> 400', async (action) => {
    const res = await post(action, token(), '123');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it.each(['start', 'end'])(
    'POST /shifts/:id/%s de un turno inexistente -> 404',
    async (action) => {
      shiftRepository.findById.mockResolvedValue(null);
      const res = await post(action, token(), MISSING_ID);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    },
  );
});

describe('POST /api/staff/shifts/:id/start', () => {
  it('inicio exitoso: dentro del rango pasa a activo y registra actualStart -> 200', async () => {
    const res = await post('start', token('WAITER'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      shiftId: SHIFT_ID,
      userId: USER_ID,
      status: 'activo',
      actualStart: INSIDE.toISOString(),
      actualEnd: null,
    });
    expect(shiftRepository.transition).toHaveBeenCalledWith(SHIFT_ID, 'programado', {
      status: 'activo',
      actualStart: INSIDE,
    });
  });

  it.each(['WAITER', 'COOK', 'ADMIN'])('un %s puede iniciar su propio turno', async (role) => {
    expect((await post('start', token(role))).status).toBe(200);
  });

  it('justo a la hora de inicio ya se puede iniciar', async () => {
    at(START);
    expect((await post('start', token())).status).toBe(200);
  });

  it('un milisegundo antes del fin todavia se puede iniciar', async () => {
    at(new Date(END.getTime() - 1));
    expect((await post('start', token())).status).toBe(200);
  });

  describe('fuera de horario: no activa y muestra cuando empieza el turno', () => {
    it('antes de la hora de inicio -> 409 INVALID_TRANSITION con el rango programado', async () => {
      at(new Date(START.getTime() - 1));
      const res = await post('start', token());
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
      expect(res.body.error.details).toEqual({
        scheduledStart: START.toISOString(),
        scheduledEnd: END.toISOString(),
        reason: 'BEFORE_START',
      });
      expect(shiftRepository.transition).not.toHaveBeenCalled();
    });

    it('a la hora exacta de fin ya no se puede (el fin no cuenta) -> 409 AFTER_END', async () => {
      at(END);
      const res = await post('start', token());
      expect(res.status).toBe(409);
      expect(res.body.error.details.reason).toBe('AFTER_END');
      expect(shiftRepository.transition).not.toHaveBeenCalled();
    });

    it('un dia despues -> 409', async () => {
      at(new Date('2026-11-10T15:00:00Z'));
      expect((await post('start', token())).status).toBe(409);
    });
  });

  describe('solo el propio empleado', () => {
    it('otro mesero -> 403 y no cambia nada', async () => {
      const res = await post('start', token('WAITER', OTHER_ID));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(shiftRepository.transition).not.toHaveBeenCalled();
    });

    it('un ADMIN tampoco puede iniciar el turno de otro -> 403', async () => {
      const res = await post('start', token('ADMIN', ADMIN_ID));
      expect(res.status).toBe(403);
      expect(shiftRepository.transition).not.toHaveBeenCalled();
    });
  });

  it.each(['activo', 'finalizado'])(
    'un turno %s no se puede iniciar de nuevo -> 409',
    async (status) => {
      shiftRepository.findById.mockResolvedValue(
        makeShift({ scheduledStart: START, scheduledEnd: END, status }),
      );
      const res = await post('start', token());
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
      expect(res.body.error.details).toEqual({ status });
      expect(shiftRepository.transition).not.toHaveBeenCalled();
    },
  );

  it('si otra peticion lo inicio justo antes (la transicion no aplica) -> 409', async () => {
    shiftRepository.transition.mockResolvedValue(null);
    const res = await post('start', token());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('no consulta a Orders para iniciar', async () => {
    await post('start', token());
    expect(ordersCalls).toHaveLength(0);
  });
});

describe('POST /api/staff/shifts/:id/end', () => {
  const ACTIVE = () =>
    makeShift({ scheduledStart: START, scheduledEnd: END, status: 'activo', actualStart: START });
  beforeEach(() => {
    shiftRepository.findById.mockResolvedValue(ACTIVE());
    // La base devuelve el turno activo ya actualizado (conserva actualStart)
    shiftRepository.transition.mockImplementation(async (_id, _from, data) => ({
      ...ACTIVE(),
      ...data,
    }));
  });

  it('fin sin mesas abiertas: pasa a finalizado y registra actualEnd -> 200', async () => {
    const res = await post('end', token('WAITER'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'finalizado',
      actualStart: START.toISOString(),
      actualEnd: INSIDE.toISOString(),
    });
    expect(shiftRepository.transition).toHaveBeenCalledWith(SHIFT_ID, 'activo', {
      status: 'finalizado',
      actualEnd: INSIDE,
    });
  });

  it('consulta a Orders las mesas abiertas del empleado con el token de servicio', async () => {
    await post('end', token('WAITER'));
    expect(ordersCalls).toHaveLength(1);
    expect(ordersCalls[0].url).toMatch(new RegExp(`/internal/tables/open\\?waiterId=${USER_ID}$`));
    expect(ordersCalls[0].init.headers['X-Service-Token']).toBe('token-de-pruebas');
  });

  it('fin con mesas abiertas -> 409 HAS_OPEN_TABLES y el turno sigue activo', async () => {
    mockOrders(ordersReplies(200, { count: 2, tables: [{ tableId: 'a' }, { tableId: 'b' }] }));
    const res = await post('end', token('WAITER'));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HAS_OPEN_TABLES');
    expect(res.body.error.message).toMatch(/administrador debe reasignarlas/);
    expect(res.body.error.details).toEqual({ count: 2 });
    expect(shiftRepository.transition).not.toHaveBeenCalled();
  });

  it('una sola mesa abierta tambien lo impide', async () => {
    mockOrders(ordersReplies(200, { count: 1 }));
    expect((await post('end', token())).status).toBe(409);
  });

  it('un cocinero puede finalizar su turno', async () => {
    expect((await post('end', token('COOK'))).status).toBe(200);
  });

  it('un ADMIN puede finalizar el turno de otro y se consultan las mesas del dueno del turno', async () => {
    const res = await post('end', token('ADMIN', ADMIN_ID));
    expect(res.status).toBe(200);
    expect(ordersCalls[0].url).toContain(`waiterId=${USER_ID}`);
    expect(ordersCalls[0].url).not.toContain(ADMIN_ID);
  });

  it('el ADMIN tambien recibe HAS_OPEN_TABLES si el empleado tiene mesas abiertas', async () => {
    mockOrders(ordersReplies(200, { count: 3 }));
    const res = await post('end', token('ADMIN', ADMIN_ID));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HAS_OPEN_TABLES');
  });

  it('otro mesero no puede finalizar el turno ajeno -> 403 sin consultar a Orders', async () => {
    const res = await post('end', token('WAITER', OTHER_ID));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(ordersCalls).toHaveLength(0);
    expect(shiftRepository.transition).not.toHaveBeenCalled();
  });

  it('se puede finalizar despues de la hora programada de fin (turno que se alargo)', async () => {
    at(new Date('2026-11-09T22:30:00Z'));
    const res = await post('end', token());
    expect(res.status).toBe(200);
    expect(res.body.actualEnd).toBe('2026-11-09T22:30:00.000Z');
  });

  it.each(['programado', 'finalizado'])(
    'un turno %s no se puede finalizar -> 409 sin consultar a Orders',
    async (status) => {
      shiftRepository.findById.mockResolvedValue(
        makeShift({ scheduledStart: START, scheduledEnd: END, status }),
      );
      const res = await post('end', token());
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_TRANSITION');
      expect(ordersCalls).toHaveLength(0);
      expect(shiftRepository.transition).not.toHaveBeenCalled();
    },
  );

  describe('Orders no disponible: no se puede asegurar que no haya mesas -> 503 y el turno sigue activo', () => {
    it.each([
      ['responde 500', () => ordersReplies(500)],
      ['responde 404 (ruta interna aun no implementada)', () => ordersReplies(404)],
      ['responde 401 (token de servicio rechazado)', () => ordersReplies(401)],
      ['conexion rechazada', () => () => Promise.reject(new TypeError('fetch failed'))],
      ['cuerpo sin count', () => ordersReplies(200, { tables: [] })],
      ['count no numerico', () => ordersReplies(200, { count: 'dos' })],
    ])('Orders %s', async (_name, make) => {
      mockOrders(make());
      const res = await post('end', token());
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
      expect(shiftRepository.transition).not.toHaveBeenCalled();
    });
  });

  it('si otra peticion lo finalizo justo antes (la transicion no aplica) -> 409', async () => {
    shiftRepository.transition.mockResolvedValue(null);
    const res = await post('end', token());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });
});
