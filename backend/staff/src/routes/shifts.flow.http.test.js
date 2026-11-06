// Flujo completo de turnos (GC-STAFF-0002 + GC-STAFF-0003): programar -> listar -> iniciar -> finalizar,
// con la app real (rutas, JWT, validacion, errores) y repositorios EN MEMORIA CON ESTADO que replican
// las reglas de la base (CHECK de staff.sql). A diferencia de las demas pruebas, aqui el estado de los
// turnos cambia de verdad entre un paso y el siguiente. Orders (mesas abiertas) y el reloj van simulados.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_ID, USER_ID, call, startApp, tokenFor } from '../test/helpers.js';

const db = vi.hoisted(() => ({ shifts: new Map(), employees: new Map() }));

vi.mock('../repositories/employee.repository.js', () => ({
  employeeRepository: { findById: async (userId) => db.employees.get(userId) ?? null },
}));

vi.mock('../repositories/shift.repository.js', () => {
  const clone = (s) => ({ ...s });
  // Mismas restricciones que db/init/schema/staff.sql: si se violan, la base rechazaria el cambio
  function assertChecks(s) {
    const ok =
      s.scheduledEnd > s.scheduledStart &&
      ['programado', 'activo', 'finalizado'].includes(s.status) &&
      ((s.status === 'programado' && s.actualStart === null && s.actualEnd === null) ||
        (s.status === 'activo' && s.actualStart !== null && s.actualEnd === null) ||
        (s.status === 'finalizado' && s.actualStart !== null && s.actualEnd !== null)) &&
      (s.actualEnd === null || s.actualEnd > s.actualStart);
    if (!ok) throw new Error(`CHECK constraint violada: ${JSON.stringify(s)}`);
  }
  return {
    shiftRepository: {
      findMany: async ({ userId, from, to } = {}) =>
        [...db.shifts.values()]
          .filter(
            (s) =>
              (!userId || s.userId === userId) &&
              (!from || (s.scheduledStart >= from && s.scheduledStart < to)),
          )
          .sort((a, b) => a.scheduledStart - b.scheduledStart || a.userId.localeCompare(b.userId))
          .map(clone),
      findById: async (id) => (db.shifts.has(id) ? clone(db.shifts.get(id)) : null),
      findActiveByUserId: async (userId) => {
        const mine = [...db.shifts.values()].filter(
          (s) => s.userId === userId && s.status === 'activo',
        );
        return mine.sort((a, b) => b.scheduledStart - a.scheduledStart)[0] ?? null;
      },
      create: async (data) => {
        const s = {
          shiftId: globalThis.crypto.randomUUID(),
          status: 'programado',
          actualStart: null,
          actualEnd: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        assertChecks(s);
        db.shifts.set(s.shiftId, s);
        return clone(s);
      },
      // Atomico como un UPDATE ... WHERE status = :from (no hay awaits entre la lectura y la escritura)
      transition: async (id, from, data) => {
        const s = db.shifts.get(id);
        if (!s || s.status !== from) return null;
        const next = { ...s, ...data, updatedAt: new Date() };
        assertChecks(next);
        db.shifts.set(id, next);
        return clone(next);
      },
    },
  };
});

let app;
const COOK_ID = '88888888-8888-4888-8888-888888888888';
const OTHER_ID = '77777777-7777-4777-8777-777777777777';
const GHOST_ID = '99999999-9999-4999-8999-999999999999';
const SERVICE_TOKEN = 'token-de-pruebas';

// Hora de Colombia (UTC-5) del lunes 9 de noviembre de 2026
const bogota = (hhmm, day = '2026-11-09') => new Date(`${day}T${hhmm}:00-05:00`);
const at = (hhmm, day) => vi.setSystemTime(bogota(hhmm, day));

// Orders simulado: mesas abiertas por empleado, o caido
const realFetch = globalThis.fetch;
const openTables = new Map();
let ordersDown = false;

const tk = {
  admin: () => tokenFor('ADMIN', { userId: ADMIN_ID }),
  waiter: () => tokenFor('WAITER', { userId: USER_ID }),
  cook: () => tokenFor('COOK', { userId: COOK_ID }),
  other: () => tokenFor('WAITER', { userId: OTHER_ID }),
};

const program = (body, token = tk.admin()) =>
  call(app.base, 'POST', '/api/staff/shifts', { token, body });
const list = (query = '', token = tk.admin()) =>
  call(app.base, 'GET', `/api/staff/shifts${query}`, { token });
const start = (id, token) => call(app.base, 'POST', `/api/staff/shifts/${id}/start`, { token });
const end = (id, token) => call(app.base, 'POST', `/api/staff/shifts/${id}/end`, { token });
const active = (userId) =>
  fetch(`${app.base}/internal/shifts/active/${userId}`, {
    headers: { 'X-Service-Token': SERVICE_TOKEN },
  }).then(async (res) => ({ status: res.status, body: await res.json() }));

const day = (userId, from, to, date = '2026-11-09') => ({
  userId,
  scheduledStart: `${date}T${from}:00-05:00`,
  scheduledEnd: `${date}T${to}:00-05:00`,
});

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at('06:00');
  db.shifts.clear();
  db.employees.clear();
  for (const userId of [USER_ID, COOK_ID, OTHER_ID]) db.employees.set(userId, { userId });
  openTables.clear();
  ordersDown = false;
  globalThis.fetch = vi.fn((url, init) => {
    if (!String(url).includes('/internal/tables/open')) return realFetch(url, init);
    if (ordersDown) return Promise.reject(new TypeError('fetch failed'));
    const waiterId = new URL(String(url)).searchParams.get('waiterId');
    const count = openTables.get(waiterId) ?? 0;
    return Promise.resolve(
      Response.json({
        count,
        tables: Array.from({ length: count }, (_, i) => ({ tableId: `t${i}` })),
      }),
    );
  });
});
afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = realFetch;
});

describe('flujo completo de un mesero', () => {
  it('programar -> listar -> iniciar fuera de hora -> iniciar -> finalizar con mesas -> finalizar sin mesas', async () => {
    // 1. El ADMIN programa el turno del lunes de 8:00 a. m. a 4:00 p. m. (hora Colombia)
    const created = await program(day(USER_ID, '08:00', '16:00'));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      userId: USER_ID,
      status: 'programado',
      actualStart: null,
      actualEnd: null,
    });
    const id = created.body.shiftId;

    // 2. Aparece en el horario de esa semana (cualquier dia de la semana sirve) y en el del empleado
    expect((await list('?week=2026-11-11')).body.map((s) => s.shiftId)).toEqual([id]);
    expect((await list(`?userId=${USER_ID}`, tk.waiter())).body.map((s) => s.shiftId)).toEqual([
      id,
    ]);
    expect((await list('?week=2026-11-16')).body).toEqual([]); // la semana siguiente esta vacia

    // 3. Todavia no tiene turno activo (Orders no le dejaria abrir mesas)
    expect((await active(USER_ID)).body).toEqual({ active: false });

    // 4. 6:00 a. m.: es antes de su hora. No se activa y se le dice cuando empieza
    const tooEarly = await start(id, tk.waiter());
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body.error.code).toBe('INVALID_TRANSITION');
    expect(tooEarly.body.error.details).toMatchObject({
      reason: 'BEFORE_START',
      scheduledStart: '2026-11-09T13:00:00.000Z',
    });
    expect((await active(USER_ID)).body.active).toBe(false);

    // 5. 8:30 a. m.: inicia. Pasa a activo con actualStart, y Orders ya lo ve activo
    at('08:30');
    const started = await start(id, tk.waiter());
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({
      status: 'activo',
      actualStart: '2026-11-09T13:30:00.000Z',
      actualEnd: null,
    });
    const nowActive = await active(USER_ID);
    expect(nowActive.body.active).toBe(true);
    expect(nowActive.body.shift).toMatchObject({ shiftId: id, status: 'activo' });
    expect((await list('?week=2026-11-09')).body[0].status).toBe('activo');

    // 6. No se puede iniciar dos veces
    const again = await start(id, tk.waiter());
    expect(again.status).toBe(409);
    expect(again.body.error.details).toEqual({ status: 'activo' });

    // 7. 4:00 p. m.: quiere cerrar pero tiene 2 mesas abiertas -> HAS_OPEN_TABLES, sigue activo
    at('16:00');
    openTables.set(USER_ID, 2);
    const blocked = await end(id, tk.waiter());
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('HAS_OPEN_TABLES');
    expect(blocked.body.error.details).toEqual({ count: 2 });
    expect((await active(USER_ID)).body.active).toBe(true);
    expect((await list(`?userId=${USER_ID}`)).body[0]).toMatchObject({
      status: 'activo',
      actualEnd: null,
    });

    // 8. El ADMIN reasigna las mesas (Orders ya no le muestra ninguna) y 4:10 p. m. finaliza
    openTables.set(USER_ID, 0);
    at('16:10');
    const finished = await end(id, tk.waiter());
    expect(finished.status).toBe(200);
    expect(finished.body).toMatchObject({
      status: 'finalizado',
      actualStart: '2026-11-09T13:30:00.000Z',
      actualEnd: '2026-11-09T21:10:00.000Z',
    });

    // 9. Orders ya no lo ve activo y el turno terminado no se puede reabrir ni cerrar otra vez
    expect((await active(USER_ID)).body).toEqual({ active: false });
    expect((await end(id, tk.waiter())).status).toBe(409);
    at('08:45', '2026-11-09');
    expect((await start(id, tk.waiter())).status).toBe(409);
    expect((await list('?week=2026-11-09')).body[0].status).toBe('finalizado');
  });
});

describe('flujo completo de un cocinero', () => {
  it('inicia y finaliza su turno (sin mesas que reasignar)', async () => {
    const { body: shift } = await program(day(COOK_ID, '07:00', '15:00'));
    at('07:05');
    expect((await start(shift.shiftId, tk.cook())).body.status).toBe('activo');
    expect((await active(COOK_ID)).body.active).toBe(true);
    at('15:00');
    const done = await end(shift.shiftId, tk.cook());
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('finalizado');
    expect(ordersDownOrCalled()).toBe(true);
  });
});

// El cocinero tambien pasa por la consulta a Orders (no depende del rol): se llamo una vez
function ordersDownOrCalled() {
  return globalThis.fetch.mock.calls.some(([url]) => String(url).includes('/internal/tables/open'));
}

describe('rango horario invalido', () => {
  it.each([
    ['fin anterior al inicio', '16:00', '08:00'],
    ['fin igual al inicio', '08:00', '08:00'],
  ])('%s -> 400 y no se crea nada', async (_name, from, to) => {
    const res = await program(day(USER_ID, from, to));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields[0].message).toMatch(/rango horario no es valido/);
    expect((await list()).body).toEqual([]);
  });

  it('despues de un rango invalido, el mismo empleado puede programarse bien', async () => {
    await program(day(USER_ID, '16:00', '08:00'));
    expect((await program(day(USER_ID, '08:00', '16:00'))).status).toBe(201);
    expect((await list()).body).toHaveLength(1);
  });

  it('empleado sin perfil en Staff -> 404 y no se crea nada', async () => {
    const res = await program(day(GHOST_ID, '08:00', '16:00'));
    expect(res.status).toBe(404);
    expect((await list()).body).toEqual([]);
  });
});

describe('permisos a lo largo del flujo', () => {
  let id;
  beforeEach(async () => {
    id = (await program(day(USER_ID, '08:00', '16:00'))).body.shiftId;
    at('09:00');
  });

  it('solo el ADMIN programa turnos', async () => {
    expect((await program(day(USER_ID, '10:00', '12:00'), tk.waiter())).status).toBe(403);
    expect((await program(day(USER_ID, '10:00', '12:00'), tk.cook())).status).toBe(403);
    expect((await list()).body).toHaveLength(1);
  });

  it('otro mesero no puede iniciar ni finalizar el turno ajeno', async () => {
    expect((await start(id, tk.other())).status).toBe(403);
    await start(id, tk.waiter());
    expect((await end(id, tk.other())).status).toBe(403);
    expect((await active(USER_ID)).body.active).toBe(true); // el turno sigue como estaba
  });

  it('el ADMIN no puede iniciar el turno de otro, pero si finalizarlo (si no tiene mesas)', async () => {
    expect((await start(id, tk.admin())).status).toBe(403);
    await start(id, tk.waiter());

    openTables.set(USER_ID, 1);
    const blocked = await end(id, tk.admin());
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('HAS_OPEN_TABLES');

    openTables.set(USER_ID, 0);
    const done = await end(id, tk.admin());
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('finalizado');
  });

  it('cualquier rol autenticado puede consultar el horario, pero sin token no', async () => {
    for (const token of [tk.admin(), tk.waiter(), tk.cook()])
      expect((await list('', token)).status).toBe(200);
    expect((await call(app.base, 'GET', '/api/staff/shifts')).status).toBe(401);
  });
});

describe('horario por semana y empleado', () => {
  it('cada consulta devuelve solo lo que corresponde (semana en hora de Colombia, lunes a domingo)', async () => {
    const mon = (await program(day(USER_ID, '08:00', '16:00', '2026-11-09'))).body.shiftId;
    const wed = (await program(day(COOK_ID, '09:00', '17:00', '2026-11-11'))).body.shiftId;
    // Domingo a las 9 p. m. (hora Colombia) = lunes 02:00Z: sigue siendo de la semana del 9, no de la del 16
    const sun = (await program(day(USER_ID, '21:00', '23:00', '2026-11-15'))).body.shiftId;
    const nextMon = (await program(day(USER_ID, '08:00', '16:00', '2026-11-16'))).body.shiftId;

    const ids = async (query) => (await list(query)).body.map((s) => s.shiftId);
    expect(await ids('?week=2026-11-12')).toEqual([mon, wed, sun]); // ordenados por inicio
    expect(await ids('?week=2026-11-16')).toEqual([nextMon]);
    expect(await ids(`?week=2026-11-09&userId=${USER_ID}`)).toEqual([mon, sun]);
    expect(await ids(`?week=2026-11-09&userId=${COOK_ID}`)).toEqual([wed]);
    expect(await ids(`?userId=${USER_ID}`)).toEqual([mon, sun, nextMon]);
    expect(await ids('')).toEqual([mon, wed, sun, nextMon]);
    expect(await ids('?week=2026-12-07')).toEqual([]);
  });
});

describe('fallos y concurrencia', () => {
  let id;
  beforeEach(async () => {
    id = (await program(day(USER_ID, '08:00', '16:00'))).body.shiftId;
    at('09:00');
    await start(id, tk.waiter());
  });

  it('si Orders no responde, el turno NO se finaliza y sigue activo (503); al volver Orders, se puede', async () => {
    ordersDown = true;
    const down = await end(id, tk.waiter());
    expect(down.status).toBe(503);
    expect(down.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect((await active(USER_ID)).body.active).toBe(true);

    ordersDown = false;
    expect((await end(id, tk.waiter())).status).toBe(200);
    expect((await active(USER_ID)).body.active).toBe(false);
  });

  it('dos peticiones simultaneas para finalizar: una gana (200) y la otra recibe 409', async () => {
    const results = await Promise.all([end(id, tk.waiter()), end(id, tk.admin())]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await list()).body[0].status).toBe('finalizado');
  });

  it('dos peticiones simultaneas para iniciar un turno programado: una gana y la otra recibe 409', async () => {
    const other = (await program(day(USER_ID, '10:00', '18:00', '2026-11-09'))).body.shiftId;
    at('10:30');
    const results = await Promise.all([start(other, tk.waiter()), start(other, tk.waiter())]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('un turno inexistente da 404 en iniciar y en finalizar', async () => {
    expect((await start(GHOST_ID, tk.waiter())).status).toBe(404);
    expect((await end(GHOST_ID, tk.waiter())).status).toBe(404);
  });
});

describe('limites del horario', () => {
  let id;
  beforeEach(async () => {
    id = (await program(day(USER_ID, '08:00', '16:00'))).body.shiftId;
  });

  it('se puede iniciar justo a la hora de inicio; a la hora exacta de fin ya no', async () => {
    at('16:00');
    const late = await start(id, tk.waiter());
    expect(late.status).toBe(409);
    expect(late.body.error.details.reason).toBe('AFTER_END');

    at('08:00');
    expect((await start(id, tk.waiter())).status).toBe(200);
  });

  it('un turno que se alargo se puede finalizar despues de su hora de fin', async () => {
    at('09:00');
    await start(id, tk.waiter());
    at('18:30');
    const done = await end(id, tk.waiter());
    expect(done.status).toBe(200);
    expect(done.body.actualEnd).toBe('2026-11-09T23:30:00.000Z');
  });

  it('finalizar 1 ms despues de iniciar respeta las reglas de la base (fin real > inicio real)', async () => {
    at('09:00');
    await start(id, tk.waiter());
    vi.setSystemTime(new Date(bogota('09:00').getTime() + 1));
    expect((await end(id, tk.waiter())).status).toBe(200);
  });
});
