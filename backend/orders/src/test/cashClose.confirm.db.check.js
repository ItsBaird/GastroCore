// GC-RPT-0002 (GC-154, GC-155). Verificacion de la confirmacion del cierre y del bloqueo post-cierre contra
// PostgreSQL REAL, en la base aislada orders_db_test (nunca orders_db). No es un test de vitest (no termina en
// .test.js): corre con el runner nativo de Node dentro del contenedor de orders:
//
//   docker compose exec -T orders sh -c \
//     'DATABASE_URL="${DATABASE_URL%/orders_db}/orders_db_test" node --test src/test/cashClose.confirm.db.check.js'
//
// Lo que los mocks no pueden probar: que las filas y desgloses quedan guardados, que el UNIQUE y el candado
// advisory funcionan de verdad (pg_advisory_xact_lock via $executeRaw) y, sobre todo, que un cobro concurrente con
// el cierre NUNCA queda dentro de un dia cerrado sin estar en el consolidado. Vacia las tablas al empezar y al terminar.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../config/prisma.js';
import { closeOrderWithPayment } from '../repositories/payment.repository.js';
import { businessDateOf } from '../services/businessDay.js';
import { confirmCashClose, getCashClosePreview } from '../services/cashClose.service.js';
import { getCashClosureByDate, listCashClosures } from '../services/cashClosures.service.js';
import { correctOrderPaymentMethod } from '../services/paymentCorrection.service.js';

const ADMIN = { userId: randomUUID(), role: 'ADMIN', permissions: [] };
const W1 = randomUUID();
const W2 = randomUUID();
const PIZZA = randomUUID();
const PASTA = randomUUID();
const MIN = 60e3;

const at = (local) => new Date(`${local.replace(' ', 'T')}:00-05:00`);
const dayOffset = (days) => businessDateOf(new Date(Date.now() + days * 24 * 3600e3));
const TODAY = () => businessDateOf(new Date());

async function wipe() {
  const [{ db }] = await prisma.$queryRaw`SELECT current_database() AS db`;
  assert.equal(db, 'orders_db_test', 'ABORTADO: este chequeo solo corre contra orders_db_test');
  await prisma.$executeRaw`TRUNCATE items, rounds, payments, qr_request_items, qr_requests, service_calls,
    cash_closure_payment_breakdown, cash_closure_top_products, cash_closure_waiter_breakdown, cash_closures,
    audit_log, orders, payment_methods, dining_tables`;
}

let tableSeq = 0;
let methods;

async function newTable() {
  return prisma.diningTable.create({
    data: { tableNumber: 2000 + ++tableSeq, qrToken: `close-${randomUUID()}` },
  });
}

async function addItem(orderId, openedBy, product, name, price, qty, when) {
  const round = await prisma.round.create({
    data: { orderId, source: 'WAITER', createdBy: openedBy, createdAt: when },
  });
  await prisma.orderItem.create({
    data: {
      roundId: round.roundId,
      productId: product,
      productNameSnapshot: name,
      unitPriceSnapshot: price,
      quantity: qty,
      status: 'entregado',
      preparationStartedAt: when,
      readyAt: new Date(when.getTime() + 10 * MIN),
      deliveredAt: new Date(when.getTime() + 12 * MIN),
      createdAt: when,
    },
  });
}

// Venta ya cerrada y pagada en `closedAt`
async function closedSale({ openedBy, method, closedAt, product = PIZZA, qty = 1 }) {
  const table = await newTable();
  const price = product === PIZZA ? 30000 : 25000;
  const order = await prisma.order.create({
    data: {
      tableId: table.tableId,
      openedBy,
      waiterId: openedBy,
      status: 'CERRADA',
      openedAt: new Date(closedAt.getTime() - 60 * MIN),
      closedAt,
    },
  });
  await addItem(
    order.orderId,
    openedBy,
    product,
    product === PIZZA ? 'Pizza' : 'Pasta',
    price,
    qty,
    new Date(closedAt.getTime() - 40 * MIN),
  );
  await prisma.payment.create({
    data: {
      orderId: order.orderId,
      paymentMethodId: methods[method],
      subtotal: price * qty,
      total: price * qty,
      registeredBy: openedBy,
      paidAt: closedAt,
    },
  });
  return order;
}

// Mesa en cobro, lista para pagar con closeOrderWithPayment (el repositorio real)
async function billingOrder(openedBy = W1) {
  const table = await newTable();
  const order = await prisma.order.create({
    data: {
      tableId: table.tableId,
      openedBy,
      waiterId: openedBy,
      status: 'EN_COBRO',
      openedAt: new Date(Date.now() - 60 * MIN),
    },
  });
  await addItem(order.orderId, openedBy, PIZZA, 'Pizza', 30000, 1, new Date(Date.now() - 40 * MIN));
  return { orderId: order.orderId, tableId: table.tableId };
}

const pay = ({ orderId, tableId }, method = 'cash') =>
  closeOrderWithPayment({
    orderId,
    tableId,
    userId: W1,
    payment: {
      paymentMethodId: methods[method],
      subtotal: 30000,
      discountAmount: 0,
      discountAppliedBy: null,
      total: 30000,
      amountReceived: null,
      changeGiven: null,
    },
    auditDetails: { total: 30000 },
  });

before(async () => {
  await wipe();
  methods = {
    cash: (await prisma.paymentMethod.create({ data: { name: 'Efectivo', isCash: true } }))
      .paymentMethodId,
    card: (await prisma.paymentMethod.create({ data: { name: 'Tarjeta', isCash: false } }))
      .paymentMethodId,
  };
});
after(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('GC-154: confirmar el cierre (BD real)', () => {
  it('guarda el consolidado, sus tres desgloses y la auditoria, iguales a la vista previa', async () => {
    const day = dayOffset(-3);
    await closedSale({ openedBy: W1, method: 'cash', closedAt: at(`${day} 09:10`), qty: 2 });
    await closedSale({
      openedBy: W1,
      method: 'card',
      closedAt: at(`${day} 20:30`),
      product: PASTA,
    });
    await closedSale({ openedBy: W2, method: 'card', closedAt: at(`${day} 23:59`) });
    await closedSale({ openedBy: W2, method: 'cash', closedAt: at(`${dayOffset(-2)} 00:00`) }); // otro dia

    const preview = await getCashClosePreview(day);
    const out = await confirmCashClose(day, ADMIN);

    assert.equal(out.totalSales, 60000 + 25000 + 30000);
    assert.equal(out.tablesServed, 3);
    assert.equal(out.averageTicket, Math.round(115000 / 3));
    assert.equal(out.confirmedBy, ADMIN.userId);
    assert.ok(out.closureId && out.confirmedAt);
    const consolidated = { ...out };
    for (const key of ['closureId', 'confirmedBy', 'confirmedAt']) delete consolidated[key];
    assert.deepEqual(consolidated, preview);

    const row = await prisma.cashClosure.findUnique({
      where: { closureId: out.closureId },
      include: { paymentBreakdown: true, topProducts: true, waiterBreakdown: true },
    });
    assert.equal(row.closureDate.toISOString().slice(0, 10), day);
    assert.equal(row.totalSales, 115000);
    assert.equal(row.tablesServed, 3);
    assert.equal(row.confirmedBy, ADMIN.userId);
    assert.deepEqual(
      row.paymentBreakdown.map((p) => [p.paymentMethodId, p.totalAmount, p.paymentCount]).sort(),
      [
        [methods.card, 55000, 2],
        [methods.cash, 60000, 1],
      ].sort(),
    );
    assert.deepEqual(
      row.waiterBreakdown.map((w) => [w.waiterId, w.totalAmount]).sort(),
      [
        [W1, 85000],
        [W2, 30000],
      ].sort(),
    );
    assert.deepEqual(
      row.topProducts
        .map((p) => [p.rank, p.productId, p.productNameSnapshot, p.quantitySold])
        .sort(),
      [
        [1, PIZZA, 'Pizza', 3],
        [2, PASTA, 'Pasta', 1],
      ].sort(),
    );

    const audit = await prisma.auditLog.findMany({
      where: { entityType: 'cash_closure', entityId: out.closureId },
    });
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actionType, 'CASH_CLOSE_CONFIRMED');
    assert.equal(audit[0].performedBy, ADMIN.userId);
    assert.deepEqual(audit[0].details, {
      date: day,
      totalSales: 115000,
      tablesServed: 3,
      averageTicket: 38333,
    });
  });

  it('criterio 2: cerrar de nuevo el mismo dia -> DAY_CLOSED y no cambia nada', async () => {
    const day = dayOffset(-3);
    const before = await prisma.cashClosure.count();
    await assert.rejects(confirmCashClose(day, ADMIN), { status: 409, code: 'DAY_CLOSED' });
    assert.equal(await prisma.cashClosure.count(), before);
    assert.equal(await prisma.auditLog.count({ where: { actionType: 'CASH_CLOSE_CONFIRMED' } }), 1);
  });

  it('un dia sin ventas se cierra con ceros y listas vacias', async () => {
    const out = await confirmCashClose(dayOffset(-10), ADMIN);
    assert.equal(out.totalSales, 0);
    assert.equal(out.tablesServed, 0);
    assert.deepEqual(out.paymentBreakdown, []);
    assert.deepEqual(out.topProducts, []);
  });

  it('un dia futuro -> 400 y no guarda nada', async () => {
    const before = await prisma.cashClosure.count();
    await assert.rejects(confirmCashClose(dayOffset(3), ADMIN), { status: 400 });
    assert.equal(await prisma.cashClosure.count(), before);
  });

  it('dos confirmaciones simultaneas del mismo dia: una gana, la otra recibe DAY_CLOSED', async () => {
    const day = dayOffset(-5);
    await closedSale({ openedBy: W1, method: 'cash', closedAt: at(`${day} 12:00`) });
    const results = await Promise.allSettled([
      confirmCashClose(day, ADMIN),
      confirmCashClose(day, ADMIN),
      confirmCashClose(day, ADMIN),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    for (const r of results.filter((x) => x.status === 'rejected')) {
      assert.equal(r.reason.code, 'DAY_CLOSED');
    }
    assert.equal(
      await prisma.cashClosure.count({ where: { closureDate: new Date(`${day}T00:00:00Z`) } }),
      1,
    );
  });
});

describe('GC-155: bloqueo de ordenes del dia post-cierre (BD real)', () => {
  it('cerrar un dia pasado NO bloquea los cobros de hoy', async () => {
    const order = await billingOrder();
    const result = await pay(order);
    assert.ok(result?.payment?.paymentId, 'el cobro de hoy debe pasar');
    assert.equal(
      (await prisma.order.findUnique({ where: { orderId: order.orderId } })).status,
      'CERRADA',
    );
  });

  it('con el dia de hoy cerrado, un cobro se rechaza: la orden sigue EN_COBRO, sin pago ni auditoria', async () => {
    await confirmCashClose(TODAY(), ADMIN);
    const order = await billingOrder();
    assert.deepEqual(await pay(order), { dayClosed: true });

    const row = await prisma.order.findUnique({ where: { orderId: order.orderId } });
    assert.equal(row.status, 'EN_COBRO');
    assert.equal(row.closedAt, null);
    assert.equal(await prisma.payment.count({ where: { orderId: order.orderId } }), 0);
    assert.equal(
      await prisma.auditLog.count({
        where: { actionType: 'PAYMENT_REGISTERED', entityId: order.orderId },
      }),
      0,
    );
  });

  it('el cierre incluyo el cobro previo y el consolidado de hoy no cambia con el intento rechazado', async () => {
    const closure = await prisma.cashClosure.findUnique({
      where: { closureDate: new Date(`${TODAY()}T00:00:00Z`) },
    });
    const live = await getCashClosePreview(TODAY());
    assert.equal(closure.totalSales, live.totalSales);
    assert.equal(closure.tablesServed, live.tablesServed);
  });
});

// El corazon de GC-155: cobros y cierre ocurriendo A LA VEZ. Invariante: el consolidado guardado es exactamente
// la suma de los pagos que existen ese dia (ni uno colado despues del cierre, ni uno perdido), y todo cobro
// que no entro recibio dayClosed.
describe('GC-155: cobros concurrentes con el cierre', () => {
  it('en 25 rondas con 8 cobros + 1 cierre en paralelo el consolidado siempre cuadra con los pagos del dia', async () => {
    const today = TODAY();
    const range = {
      start: at(`${today} 00:00`),
      end: new Date(at(`${today} 00:00`).getTime() + 24 * 3600e3),
    };
    let rejectedTotal = 0;
    let acceptedTotal = 0;

    for (let round = 1; round <= 25; round++) {
      await prisma.cashClosure.deleteMany({
        where: { closureDate: new Date(`${today}T00:00:00Z`) },
      });
      const orders = await Promise.all(Array.from({ length: 8 }, () => billingOrder()));

      const [closeResult, ...payResults] = await Promise.allSettled([
        confirmCashClose(today, ADMIN),
        ...orders.map((o) => pay(o)),
      ]);
      assert.equal(
        closeResult.status,
        'fulfilled',
        `ronda ${round}: el cierre debe poder confirmarse`,
      );
      for (const r of payResults)
        assert.equal(r.status, 'fulfilled', `ronda ${round}: ${r.reason}`);

      const accepted = payResults.filter((r) => r.value?.payment).length;
      const rejected = payResults.filter((r) => r.value?.dayClosed).length;
      assert.equal(accepted + rejected, 8);
      acceptedTotal += accepted;
      rejectedTotal += rejected;

      const sums = await prisma.payment.aggregate({
        _sum: { total: true },
        _count: true,
        where: { order: { status: 'CERRADA', closedAt: { gte: range.start, lt: range.end } } },
      });
      const closure = await prisma.cashClosure.findUnique({
        where: { closureDate: new Date(`${today}T00:00:00Z`) },
      });
      assert.equal(
        closure.totalSales,
        sums._sum.total ?? 0,
        `ronda ${round}: ventas del cierre != pagos del dia`,
      );
      assert.equal(
        closure.tablesServed,
        sums._count,
        `ronda ${round}: mesas del cierre != pagos del dia`,
      );

      // Los rechazados siguen EN_COBRO y sin pago
      const stillBilling = await prisma.order.count({
        where: { orderId: { in: orders.map((o) => o.orderId) }, status: 'EN_COBRO' },
      });
      assert.equal(stillBilling, rejected, `ronda ${round}: rechazados != ordenes sin cobrar`);
    }
    console.log(
      `25 rondas: ${acceptedTotal} cobros entraron antes del cierre, ${rejectedTotal} fueron rechazados`,
    );
  });
});

// GC-157: correccion del metodo de pago de una venta de un dia YA cerrado. El cierre guardado no se toca (snapshot);
// la correccion queda en audit_log con quien, cuando, que y cuanto.
describe('GC-157: correccion post-cierre del metodo de pago (BD real)', () => {
  let day;
  let sale;
  let closureBefore;

  it('efectivo -> tarjeta en un dia cerrado: cambia el pago, audita y NO modifica el cierre guardado', async () => {
    day = dayOffset(-20);
    sale = await closedSale({ openedBy: W1, method: 'cash', closedAt: at(`${day} 13:00`), qty: 2 });
    await confirmCashClose(day, ADMIN);
    closureBefore = await prisma.cashClosure.findUnique({
      where: { closureDate: new Date(`${day}T00:00:00Z`) },
      include: { paymentBreakdown: true },
    });

    const out = await correctOrderPaymentMethod(
      sale.orderId,
      { paymentMethodId: methods.card, reason: 'Se cobro con tarjeta, se registro efectivo' },
      ADMIN,
    );
    assert.equal(out.paymentMethodId, methods.card);
    assert.equal(out.total, 60000);
    assert.equal(out.amountReceived, null);
    assert.equal(out.changeGiven, null);

    const row = await prisma.payment.findUnique({ where: { orderId: sale.orderId } });
    assert.equal(row.paymentMethodId, methods.card);
    assert.equal(row.total, 60000);
    assert.equal(row.subtotal, 60000);

    const audit = await prisma.auditLog.findMany({
      where: { actionType: 'PAYMENT_METHOD_CORRECTED', entityId: sale.orderId },
    });
    assert.equal(audit.length, 1);
    assert.equal(audit[0].entityType, 'order');
    assert.equal(audit[0].performedBy, ADMIN.userId);
    assert.ok(audit[0].performedAt instanceof Date);
    assert.deepEqual(audit[0].details, {
      paymentId: row.paymentId,
      previousMethodId: methods.cash,
      previousMethod: 'Efectivo',
      newMethodId: methods.card,
      newMethod: 'Tarjeta',
      total: 60000,
      previousAmountReceived: null,
      previousChangeGiven: null,
      amountReceived: null,
      changeGiven: null,
      reason: 'Se cobro con tarjeta, se registro efectivo',
      postClosure: true,
      closureDate: day,
    });

    // Snapshot inmutable: el cierre sigue diciendo lo que se confirmo ese dia
    const closureAfter = await prisma.cashClosure.findUnique({
      where: { closureDate: new Date(`${day}T00:00:00Z`) },
      include: { paymentBreakdown: true },
    });
    assert.deepEqual(closureAfter, closureBefore);
    assert.deepEqual(
      closureAfter.paymentBreakdown.map((p) => [p.paymentMethodId, p.totalAmount]),
      [[methods.cash, 60000]],
    );
  });

  it('tarjeta -> efectivo: pide lo recibido, el servidor calcula el cambio y lo audita', async () => {
    const out = await correctOrderPaymentMethod(
      sale.orderId,
      { paymentMethodId: methods.cash, amountReceived: 70000, reason: 'Corregido de nuevo' },
      ADMIN,
    );
    assert.equal(out.amountReceived, 70000);
    assert.equal(out.changeGiven, 10000);
    const [last] = await prisma.auditLog.findMany({
      where: { actionType: 'PAYMENT_METHOD_CORRECTED', entityId: sale.orderId },
      orderBy: { auditId: 'desc' },
      take: 1,
    });
    assert.equal(last.details.previousMethod, 'Tarjeta');
    assert.equal(last.details.newMethod, 'Efectivo');
    assert.equal(last.details.changeGiven, 10000);
  });

  it('reglas: mismo metodo, efectivo sin monto o insuficiente y orden sin cerrar no cambian ni auditan nada', async () => {
    const audits = () =>
      prisma.auditLog.count({ where: { actionType: 'PAYMENT_METHOD_CORRECTED' } });
    const before = await audits();
    await assert.rejects(
      correctOrderPaymentMethod(
        sale.orderId,
        { paymentMethodId: methods.cash, amountReceived: 70000, reason: 'Sin cambios' },
        ADMIN,
      ),
      { status: 400, code: 'VALIDATION_ERROR' },
    );
    await assert.rejects(
      correctOrderPaymentMethod(
        sale.orderId,
        { paymentMethodId: methods.card, amountReceived: 1, reason: 'Con monto' },
        ADMIN,
      ),
      { status: 400, code: 'VALIDATION_ERROR' },
    );
    const billing = await billingOrder();
    await assert.rejects(
      correctOrderPaymentMethod(
        billing.orderId,
        { paymentMethodId: methods.card, reason: 'Sin pago aun' },
        ADMIN,
      ),
      { status: 404 },
    );
    assert.equal(await audits(), before);
  });

  it('dos correcciones simultaneas: una gana, la otra recibe 409 y solo queda una auditoria nueva', async () => {
    const racing = await closedSale({ openedBy: W2, method: 'cash', closedAt: at(`${day} 15:00`) });
    const results = await Promise.allSettled([
      correctOrderPaymentMethod(
        racing.orderId,
        { paymentMethodId: methods.card, reason: 'Primera correccion' },
        ADMIN,
      ),
      correctOrderPaymentMethod(
        racing.orderId,
        { paymentMethodId: methods.card, reason: 'Segunda correccion' },
        ADMIN,
      ),
      correctOrderPaymentMethod(
        racing.orderId,
        { paymentMethodId: methods.card, reason: 'Tercera correccion' },
        ADMIN,
      ),
    ]);
    const won = results.filter((r) => r.status === 'fulfilled').length;
    assert.equal(won, 1);
    for (const r of results.filter((x) => x.status === 'rejected')) {
      assert.ok([400, 409].includes(r.reason.status), `inesperado: ${r.reason}`);
    }
    assert.equal(
      await prisma.auditLog.count({
        where: { actionType: 'PAYMENT_METHOD_CORRECTED', entityId: racing.orderId },
      }),
      1,
    );
  });
});

// GC-158: historial de cierres y cierre por dia, leidos de la base real
describe('GC-158: historial y cierre por dia (BD real)', () => {
  it('el historial lista los cierres del mas reciente al mas antiguo, con total y pagina', async () => {
    const all = await prisma.cashClosure.findMany({ orderBy: { closureDate: 'desc' } });
    assert.ok(all.length >= 4, 'los chequeos anteriores dejaron varios cierres');

    const first = await listCashClosures({ page: 1, pageSize: 3 });
    assert.equal(first.total, all.length);
    assert.equal(first.items.length, 3);
    assert.deepEqual(
      first.items.map((i) => i.date),
      all.slice(0, 3).map((c) => c.closureDate.toISOString().slice(0, 10)),
    );
    for (let i = 1; i < first.items.length; i++)
      assert.ok(first.items[i - 1].date > first.items[i].date);

    const second = await listCashClosures({ page: 2, pageSize: 3 });
    assert.deepEqual(
      second.items.map((i) => i.closureId),
      all.slice(3, 6).map((c) => c.closureId),
    );
    const past = await listCashClosures({ page: 99, pageSize: 3 });
    assert.deepEqual(past.items, []);
    assert.equal(past.total, all.length);
  });

  it('cada fila del historial trae el resumen guardado y quien confirmo', async () => {
    const { items } = await listCashClosures({ page: 1, pageSize: 50 });
    for (const item of items) {
      const row = await prisma.cashClosure.findUnique({ where: { closureId: item.closureId } });
      assert.equal(item.totalSales, row.totalSales);
      assert.equal(item.tablesServed, row.tablesServed);
      assert.equal(item.averageTicket, row.averageTicket);
      assert.equal(item.confirmedBy, row.confirmedBy);
      assert.deepEqual(Object.keys(item).sort(), [
        'averageTicket',
        'closureId',
        'confirmedAt',
        'confirmedBy',
        'date',
        'tablesServed',
        'totalSales',
      ]);
    }
  });

  it('el cierre por dia devuelve el SNAPSHOT guardado, igual al que respondio el POST, con desgloses ordenados', async () => {
    const day = dayOffset(-30);
    await closedSale({ openedBy: W1, method: 'card', closedAt: at(`${day} 10:00`), qty: 3 });
    await closedSale({
      openedBy: W2,
      method: 'cash',
      closedAt: at(`${day} 11:00`),
      product: PASTA,
    });
    const posted = await confirmCashClose(day, ADMIN);
    const read = await getCashClosureByDate(day);
    assert.deepEqual(JSON.parse(JSON.stringify(read)), JSON.parse(JSON.stringify(posted)));
    assert.deepEqual(
      read.paymentBreakdown.map((p) => p.totalAmount),
      [90000, 25000],
    );
    assert.deepEqual(
      read.topProducts.map((p) => p.rank),
      [1, 2],
    );
  });

  it('un dia sin cierre -> 404 NOT_FOUND', async () => {
    await assert.rejects(getCashClosureByDate(dayOffset(-400)), { status: 404, code: 'NOT_FOUND' });
  });

  it('despues de una correccion post-cierre el cierre por dia sigue mostrando lo CONFIRMADO (no se recalcula)', async () => {
    const day = dayOffset(-20); // cerrado y corregido en el bloque de GC-157
    const read = await getCashClosureByDate(day);
    assert.deepEqual(
      read.paymentBreakdown.map((p) => [p.paymentMethodId, p.totalAmount]),
      [[methods.cash, 60000]],
    );
  });
});
