// GC-159. HU GC-RPT-0002 de punta a punta: cierre exitoso, cierre duplicado y correccion posterior, con la
// aplicacion REAL (rutas, JWT, validacion, servicios) y una base en memoria con estado compartido entre
// endpoints. Asi se comprueba lo que las pruebas aisladas no pueden: que lo que POST /cash-close guarda es lo
// que luego devuelven el historial y el cierre por dia, que un cobro tras el cierre se rechaza, y que una
// correccion deja su rastro en audit_log sin tocar el cierre guardado.
// Cada pieza tiene su prueba (servicios, repositorios, rutas) y el SQL, el candado y la concurrencia se
// verificaron contra PostgreSQL real (src/test/cashClose.confirm.db.check.js).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_ID, call, startApp, tokenFor } from '../test/helpers.js';

const h = vi.hoisted(() => ({ db: null, seq: 0 }));

vi.mock('../config/prisma.js', () => ({ prisma: {} }));
vi.mock('../realtime/events.js', async (original) => ({
  ...(await original()),
  emitOrderUpdated: vi.fn(),
  emitTableStatusChanged: vi.fn(),
}));
vi.mock('../services/tableStatus.service.js', async (original) => ({
  ...(await original()),
  getTableStatus: vi.fn().mockResolvedValue(null),
}));

// ---- Lectura del dia: misma regla que reports.repository.js (CERRADA con closedAt en [start, end)) ----
const inDay = (o, { start, end }) =>
  o.status === 'CERRADA' && o.closedAt >= start && o.closedAt < end;
const itemsOf = (o) => o.rounds.flatMap((r) => r.items);
vi.mock('../repositories/reports.repository.js', () => ({
  findPaymentsOfDay: async (range) =>
    h.db.orders
      .filter((o) => inDay(o, range) && o.payment)
      .map((o) => ({
        total: o.payment.total,
        paymentMethodId: o.payment.paymentMethodId,
        order: { openedBy: o.openedBy },
      })),
  findSoldItemsOfDay: async (range) =>
    h.db.orders
      .filter((o) => inDay(o, range))
      .flatMap(itemsOf)
      .filter((i) => i.status !== 'cancelado'),
}));

// ---- Confirmar el cierre: como la transaccion real (un dia = un cierre, consolidado + desgloses + auditoria) ----
vi.mock('../repositories/cashClosure.repository.js', async () => {
  const { findPaymentsOfDay, findSoldItemsOfDay } =
    await import('../repositories/reports.repository.js');
  return {
    confirmClosure: async ({ date, range, userId, build }) => {
      if (h.db.closures.some((c) => c.date === date)) return { alreadyClosed: true };
      const preview = build({
        payments: await findPaymentsOfDay(range),
        items: await findSoldItemsOfDay(range),
      });
      const closure = {
        closureId: `cccccccc-cccc-4ccc-8ccc-${String(++h.seq).padStart(12, '0')}`,
        date,
        confirmedBy: userId,
        confirmedAt: new Date(),
        snapshot: structuredClone(preview),
      };
      h.db.closures.push(closure);
      h.db.audits.push({
        actionType: 'CASH_CLOSE_CONFIRMED',
        entityType: 'cash_closure',
        entityId: closure.closureId,
        performedBy: userId,
        performedAt: new Date(),
        details: { date, totalSales: preview.totalSales, tablesServed: preview.tablesServed },
      });
      return { closure, preview };
    },
  };
});

// ---- Leer cierres guardados: las filas como las devuelve Prisma ----
function closureRow(c) {
  const s = c.snapshot;
  return {
    closureId: c.closureId,
    closureDate: new Date(`${c.date}T00:00:00Z`),
    totalSales: s.totalSales,
    tablesServed: s.tablesServed,
    averageTicket: s.averageTicket,
    confirmedBy: c.confirmedBy,
    confirmedAt: c.confirmedAt,
    paymentBreakdown: s.paymentBreakdown.map((p) => ({ closureId: c.closureId, ...p })),
    topProducts: s.topProducts.map((p) => ({
      closureId: c.closureId,
      rank: p.rank,
      productId: p.productId,
      productNameSnapshot: p.productName,
      quantitySold: p.quantitySold,
    })),
    waiterBreakdown: s.waiterBreakdown.map((w) => ({ closureId: c.closureId, ...w })),
  };
}
vi.mock('../repositories/cashClosureQuery.repository.js', () => ({
  listClosures: async ({ skip, take }) => {
    const rows = [...h.db.closures].sort((a, b) => (a.date < b.date ? 1 : -1)).map(closureRow);
    return { rows: rows.slice(skip, skip + take), total: rows.length };
  },
  findClosureByDate: async (date) => {
    const found = h.db.closures.find((c) => c.date === date);
    return found ? closureRow(found) : null;
  },
}));

// ---- Cobro: rechazado si el dia de negocio de hoy ya esta cerrado (candado + cierre en una transaccion) ----
vi.mock('../repositories/payment.repository.js', async () => {
  const { businessDateOf } = await import('../services/businessDay.js');
  return {
    closeOrderWithPayment: async ({ orderId, payment, userId, auditDetails }) => {
      const now = new Date();
      if (h.db.closures.some((c) => c.date === businessDateOf(now))) return { dayClosed: true };
      const order = h.db.orders.find((o) => o.orderId === orderId);
      if (order?.status !== 'EN_COBRO') return null;
      order.status = 'CERRADA';
      order.closedAt = now;
      order.payment = {
        paymentId: `99999999-9999-4999-8999-${String(++h.seq).padStart(12, '0')}`,
        orderId,
        ...payment,
        registeredBy: userId,
        paidAt: now,
      };
      h.db.audits.push({
        actionType: 'PAYMENT_REGISTERED',
        entityType: 'order',
        entityId: orderId,
        performedBy: userId,
        performedAt: now,
        details: auditDetails,
      });
      return { payment: order.payment, rejectedQrRequests: 0, attendedServiceCalls: 0 };
    },
  };
});
vi.mock('../repositories/bill.repository.js', () => ({
  findOrderForBill: async (orderId) => h.db.orders.find((o) => o.orderId === orderId) ?? null,
  moveOrderToBilling: vi.fn(),
  moveOrderBackToOpen: vi.fn(),
  setOrderDiscount: vi.fn(),
}));
vi.mock('../repositories/paymentMethod.repository.js', () => ({
  findPaymentMethodById: async (id) => h.db.methods[id] ?? null,
  findPaymentMethodByName: vi.fn(),
  findAllPaymentMethods: vi.fn(),
  countPaymentsByMethod: vi.fn(),
  createPaymentMethod: vi.fn(),
  updatePaymentMethod: vi.fn(),
}));

// ---- Correccion post-cierre: cambia el metodo y audita (postClosure segun el cierre del dia de la venta) ----
vi.mock('../repositories/paymentCorrection.repository.js', async () => {
  const { businessDateOf } = await import('../services/businessDay.js');
  return {
    findPaymentOfOrder: async (orderId) => {
      const o = h.db.orders.find((x) => x.orderId === orderId);
      return o ? { orderId, status: o.status, closedAt: o.closedAt, payment: o.payment } : null;
    },
    correctPaymentMethod: async ({
      orderId,
      closedAt,
      userId,
      expectedMethodId,
      update,
      auditDetails,
    }) => {
      const order = h.db.orders.find((o) => o.orderId === orderId);
      if (order.payment.paymentMethodId !== expectedMethodId) return { changed: true };
      Object.assign(order.payment, update);
      const date = businessDateOf(closedAt);
      const postClosure = h.db.closures.some((c) => c.date === date);
      h.db.audits.push({
        actionType: 'PAYMENT_METHOD_CORRECTED',
        entityType: 'order',
        entityId: orderId,
        performedBy: userId,
        performedAt: new Date(),
        details: { ...auditDetails, postClosure, ...(postClosure && { closureDate: date }) },
      });
      return { payment: order.payment };
    },
  };
});

// ------------------------------------------------------------------------------------------------------------
const CASH = '11111111-1111-4111-8111-111111111111';
const CARD = '22222222-2222-4222-8222-222222222222';
const OFF = '33333333-3333-4333-8333-333333333333';
const WAITER = '44444444-4444-4444-8444-444444444444';
const OTHER_WAITER = '55555555-5555-4555-8555-555555555555';
const PIZZA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PASTA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const TODAY = '2026-11-14'; // "ahora" = 14-nov 18:30 hora de Colombia (23:30 UTC)
const YESTERDAY = '2026-11-13';
const API = '/api/orders';
const CLOSE = `${API}/reports/cash-close`;
const CLOSURES = `${API}/reports/cash-closures`;

let nextOrder = 0;
const orderId = () => `00000000-0000-4000-8000-${String(++nextOrder).padStart(12, '0')}`;
const item = (productId, name, price, quantity) => ({
  productId,
  productNameSnapshot: name,
  unitPriceSnapshot: price,
  quantity,
  status: 'entregado',
  createdAt: new Date('2026-11-14T15:00:00Z'),
});

// Una venta ya cobrada y cerrada
function paidOrder({ closedAt, openedBy = WAITER, method, items }) {
  const total = items.reduce((s, i) => s + i.unitPriceSnapshot * i.quantity, 0);
  const id = orderId();
  return {
    orderId: id,
    tableId: 'table-1',
    openedBy,
    waiterId: openedBy,
    status: 'CERRADA',
    closedAt: new Date(closedAt),
    discountAmount: 0,
    discountAppliedBy: null,
    table: { tableId: 'table-1', tableNumber: 5 },
    rounds: [{ items }],
    payment: {
      paymentId: `88888888-8888-4888-8888-${String(nextOrder).padStart(12, '0')}`,
      orderId: id,
      paymentMethodId: method,
      subtotal: total,
      discountAmount: 0,
      total,
      amountReceived: method === CASH ? total + 2000 : null,
      changeGiven: method === CASH ? 2000 : null,
      registeredBy: openedBy,
      paidAt: new Date(closedAt),
    },
  };
}

// Una mesa en cobro de $45.000 lista para pagar
function billingOrder(waiterId = WAITER) {
  return {
    orderId: orderId(),
    tableId: 'table-2',
    openedBy: waiterId,
    waiterId,
    status: 'EN_COBRO',
    closedAt: null,
    discountAmount: 0,
    discountAppliedBy: null,
    table: { tableId: 'table-2', tableNumber: 9 },
    rounds: [{ items: [item(PASTA, 'Pasta Carbonara', 25000, 1), item(PIZZA, 'Pizza', 20000, 1)] }],
    payment: null,
  };
}

function seed() {
  nextOrder = 0;
  h.seq = 0;
  h.db = {
    closures: [],
    audits: [],
    methods: {
      [CASH]: { paymentMethodId: CASH, name: 'Efectivo', isCash: true, isActive: true },
      [CARD]: { paymentMethodId: CARD, name: 'Tarjeta', isCash: false, isActive: true },
      [OFF]: { paymentMethodId: OFF, name: 'Cheque', isCash: false, isActive: false },
    },
    orders: [
      // Del 14 (hoy): $56.000 en efectivo + $30.000 en tarjeta (otro mesero) + $60.000 en tarjeta
      paidOrder({
        closedAt: '2026-11-14T15:00:00Z',
        method: CASH,
        items: [item(PIZZA, 'Pizza', 28000, 2)],
      }),
      paidOrder({
        closedAt: '2026-11-14T18:00:00Z',
        method: CARD,
        openedBy: OTHER_WAITER,
        items: [item(PASTA, 'Pasta Carbonara', 30000, 1)],
      }),
      paidOrder({
        closedAt: '2026-11-15T01:00:00Z', // 8:00 p. m. del 14 en Colombia (01:00 UTC del 15)
        method: CARD,
        items: [item(PIZZA, 'Pizza', 30000, 2)],
      }),
      // Del 13: no debe entrar en el cierre del 14
      paidOrder({
        closedAt: '2026-11-13T20:00:00Z',
        method: CASH,
        items: [item(PIZZA, 'Pizza', 30000, 1)],
      }),
      billingOrder(),
    ],
  };
}

const TOTAL_TODAY = 56000 + 30000 + 60000;
const BILLING = () => h.db.orders.find((o) => o.status === 'EN_COBRO');
const CLOSED_TODAY = () => h.db.orders[0]; // $56.000 en efectivo
const admin = () => tokenFor('ADMIN', { userId: ADMIN_ID });
const waiter = () => tokenFor('WAITER', { userId: WAITER });

let app;
const post = (token, body) => call(app.base, 'POST', CLOSE, { token, body });
const get = (path, token = admin()) => call(app.base, 'GET', path, { token });
const pay = (token, order = BILLING(), body = { paymentMethodId: CARD }) =>
  call(app.base, 'POST', `${API}/${order.orderId}/pay`, { token, body });
const correct = (token, order, body) =>
  call(app.base, 'PATCH', `${API}/${order.orderId}/payment`, { token, body });
const audits = (actionType) => h.db.audits.filter((a) => a.actionType === actionType);

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-14T23:30:00Z'));
  seed();
});
afterEach(() => vi.useRealTimers());

describe('criterio 1: cierre exitoso', () => {
  it('confirma el dia: 201 con el consolidado de la vista previa, closureId, confirmedBy y confirmedAt', async () => {
    const preview = (await get(`${CLOSE}?date=${TODAY}`)).body;
    expect(preview.totalSales).toBe(TOTAL_TODAY);

    const res = await post(admin(), { date: TODAY });
    expect(res.status).toBe(201);
    const { closureId, confirmedBy, confirmedAt, ...consolidated } = res.body;
    expect(consolidated).toEqual(preview);
    expect(closureId).toMatch(/^[0-9a-f-]{36}$/);
    expect(confirmedBy).toBe(ADMIN_ID);
    expect(confirmedAt).toBe('2026-11-14T23:30:00.000Z');
  });

  it('solo cuenta las ordenes de ESE dia de negocio (la del 13 y la de las 8 p. m. del 14 quedan donde van)', async () => {
    const res = await post(admin(), { date: TODAY });
    expect(res.body.tablesServed).toBe(3);
    expect(res.body.totalSales).toBe(TOTAL_TODAY);
    expect(res.body.averageTicket).toBe(Math.round(TOTAL_TODAY / 3));
  });

  it('guarda el consolidado con sus tres desgloses y lo que se guardo es lo que devuelve el cierre por dia', async () => {
    const posted = (await post(admin(), { date: TODAY })).body;
    const read = await get(`${CLOSURES}/${TODAY}`);
    expect(read.status).toBe(200);
    expect(read.body).toEqual(posted);
    expect(read.body.paymentBreakdown).toEqual([
      { paymentMethodId: CARD, totalAmount: 90000, paymentCount: 2 },
      { paymentMethodId: CASH, totalAmount: 56000, paymentCount: 1 },
    ]);
    expect(read.body.waiterBreakdown).toEqual([
      { waiterId: WAITER, totalAmount: 116000 },
      { waiterId: OTHER_WAITER, totalAmount: 30000 },
    ]);
    expect(read.body.topProducts[0]).toMatchObject({
      rank: 1,
      productName: 'Pizza',
      quantitySold: 4,
    });
  });

  it('el cierre aparece en el historial con su resumen', async () => {
    expect((await get(CLOSURES)).body).toEqual({ items: [], page: 1, pageSize: 10, total: 0 });
    await post(admin(), { date: TODAY });
    const list = (await get(CLOSURES)).body;
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({
      date: TODAY,
      totalSales: TOTAL_TODAY,
      tablesServed: 3,
      confirmedBy: ADMIN_ID,
    });
  });

  it('registra la confirmacion en audit_log (quien, cuando, cuanto)', async () => {
    await post(admin(), { date: TODAY });
    expect(audits('CASH_CLOSE_CONFIRMED')).toEqual([
      expect.objectContaining({
        performedBy: ADMIN_ID,
        performedAt: new Date('2026-11-14T23:30:00Z'),
        details: { date: TODAY, totalSales: TOTAL_TODAY, tablesServed: 3 },
      }),
    ]);
  });

  it('un mesero no puede confirmar el cierre: 403 y no se guarda nada', async () => {
    const res = await post(waiter(), { date: TODAY });
    expect(res.status).toBe(403);
    expect(h.db.closures).toHaveLength(0);
  });

  it('un dia futuro no se puede cerrar: 400 y no se guarda nada', async () => {
    const res = await post(admin(), { date: '2026-11-15' });
    expect(res.status).toBe(400);
    expect(h.db.closures).toHaveLength(0);
  });
});

describe('criterio 2: dia ya cerrado', () => {
  it('cerrar de nuevo el mismo dia -> 409 DAY_CLOSED y el primer cierre queda intacto', async () => {
    const first = (await post(admin(), { date: TODAY })).body;
    vi.setSystemTime(new Date('2026-11-14T23:45:00Z'));

    const again = await post(admin(), { date: TODAY });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: 'DAY_CLOSED', details: { date: TODAY } });

    expect(h.db.closures).toHaveLength(1);
    expect(audits('CASH_CLOSE_CONFIRMED')).toHaveLength(1);
    expect((await get(`${CLOSURES}/${TODAY}`)).body).toEqual(first);
  });

  it('cerrar un dia no impide cerrar otro: cada dia tiene su propio cierre', async () => {
    expect((await post(admin(), { date: TODAY })).status).toBe(201);
    const other = await post(admin(), { date: YESTERDAY });
    expect(other.status).toBe(201);
    expect(other.body.totalSales).toBe(30000);
    expect((await get(CLOSURES)).body.items.map((i) => i.date)).toEqual([TODAY, YESTERDAY]);
  });

  it('bloqueo: con el dia cerrado un cobro se rechaza con 409 DAY_CLOSED y la mesa sigue en cobro', async () => {
    await post(admin(), { date: TODAY });
    const res = await pay(waiter());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DAY_CLOSED');
    expect(BILLING().status).toBe('EN_COBRO');
    expect(BILLING().payment).toBeNull();
    expect(audits('PAYMENT_REGISTERED')).toHaveLength(0);
  });

  it('el ADMIN tampoco puede cobrar en un dia cerrado', async () => {
    await post(admin(), { date: TODAY });
    expect((await pay(admin())).status).toBe(409);
  });

  it('un dia anterior cerrado NO bloquea los cobros de hoy', async () => {
    await post(admin(), { date: YESTERDAY });
    const res = await pay(waiter());
    expect(res.status).toBe(201);
    expect(BILLING()).toBeUndefined();
  });

  it('un cobro ANTES del cierre queda dentro del consolidado de ese dia', async () => {
    expect((await pay(waiter())).status).toBe(201);
    const closed = (await post(admin(), { date: TODAY })).body;
    expect(closed.totalSales).toBe(TOTAL_TODAY + 45000);
    expect(closed.tablesServed).toBe(4);
  });

  it('despues del cierre el dia queda bloqueado y el consolidado ya no cambia', async () => {
    const closed = (await post(admin(), { date: TODAY })).body;
    await pay(waiter());
    expect((await get(`${CLOSURES}/${TODAY}`)).body.totalSales).toBe(closed.totalSales);
  });
});

describe('criterio 3: correccion posterior (solo ADMIN, queda en audit_log)', () => {
  const body = (extra = {}) => ({
    paymentMethodId: CARD,
    reason: 'Se cobro con tarjeta',
    ...extra,
  });

  it('el ADMIN corrige el metodo de una venta de un dia YA cerrado: 200 y el total no cambia', async () => {
    await post(admin(), { date: TODAY });
    const order = CLOSED_TODAY();

    const res = await correct(admin(), order, body());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      paymentMethodId: CARD,
      subtotal: 56000,
      total: 56000,
      amountReceived: null,
      changeGiven: null,
    });
    expect(order.payment.paymentMethodId).toBe(CARD);
  });

  it('audit_log dice quien, cuando, que y cuanto, y que fue despues del cierre', async () => {
    await post(admin(), { date: TODAY });
    vi.setSystemTime(new Date('2026-11-15T14:00:00Z')); // al dia siguiente
    const order = CLOSED_TODAY();
    await correct(admin(), order, body({ reason: 'Error al digitar' }));

    const [entry] = audits('PAYMENT_METHOD_CORRECTED');
    expect(entry).toMatchObject({
      entityType: 'order',
      entityId: order.orderId,
      performedBy: ADMIN_ID,
      performedAt: new Date('2026-11-15T14:00:00Z'),
    });
    expect(entry.details).toMatchObject({
      previousMethod: 'Efectivo',
      newMethod: 'Tarjeta',
      total: 56000,
      reason: 'Error al digitar',
      postClosure: true,
      closureDate: TODAY,
    });
  });

  it('el cierre guardado NO cambia con la correccion (snapshot), aunque el pago si', async () => {
    await post(admin(), { date: TODAY });
    const before = (await get(`${CLOSURES}/${TODAY}`)).body;

    await correct(admin(), CLOSED_TODAY(), body());

    expect((await get(`${CLOSURES}/${TODAY}`)).body).toEqual(before);
    expect(before.paymentBreakdown.find((p) => p.paymentMethodId === CASH).totalAmount).toBe(56000);
  });

  it('tarjeta -> efectivo exige lo recibido y el servidor calcula el cambio', async () => {
    const card = h.db.orders[1]; // $30.000 en tarjeta
    expect((await correct(admin(), card, body({ paymentMethodId: CASH }))).status).toBe(400);
    const res = await correct(
      admin(),
      card,
      body({ paymentMethodId: CASH, amountReceived: 50000 }),
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ amountReceived: 50000, changeGiven: 20000, total: 30000 });
  });

  it('antes del cierre tambien se puede corregir, marcado como postClosure=false', async () => {
    await correct(admin(), CLOSED_TODAY(), body());
    expect(audits('PAYMENT_METHOD_CORRECTED')[0].details.postClosure).toBe(false);
  });

  it.each(['WAITER', 'COOK'])(
    'un %s no puede corregir: 403 y no cambia ni audita nada',
    async (role) => {
      await post(admin(), { date: TODAY });
      const order = CLOSED_TODAY();
      const res = await correct(tokenFor(role, { userId: WAITER }), order, body());
      expect(res.status).toBe(403);
      expect(order.payment.paymentMethodId).toBe(CASH);
      expect(audits('PAYMENT_METHOD_CORRECTED')).toHaveLength(0);
    },
  );

  it('reglas: mismo metodo, sin motivo, metodo inactivo y orden sin cobrar no cambian ni auditan nada', async () => {
    await post(admin(), { date: TODAY });
    const order = CLOSED_TODAY();
    const same = await correct(
      admin(),
      order,
      body({ paymentMethodId: CASH, amountReceived: 60000 }),
    );
    expect(same.status).toBe(400);
    expect(same.body.error.details).toMatchObject({ field: 'paymentMethodId' });
    expect((await correct(admin(), order, { paymentMethodId: CARD })).status).toBe(400);
    expect((await correct(admin(), order, body({ paymentMethodId: OFF }))).status).toBe(409);
    expect((await correct(admin(), BILLING(), body())).status).toBe(404);
    expect(order.payment.paymentMethodId).toBe(CASH);
    expect(audits('PAYMENT_METHOD_CORRECTED')).toHaveLength(0);
  });

  it('la correccion no reabre el dia: un cobro nuevo sigue rechazado', async () => {
    await post(admin(), { date: TODAY });
    await correct(admin(), CLOSED_TODAY(), body());
    expect((await pay(waiter())).status).toBe(409);
  });
});
