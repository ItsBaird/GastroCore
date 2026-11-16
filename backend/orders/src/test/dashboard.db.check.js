// GC-RPT-0004 (GC-201). Verificacion del SQL del dashboard contra PostgreSQL REAL, en una base de pruebas aislada.
// No es un test de vitest (no termina en .test.js): corre con el runner nativo de Node dentro del contenedor de
// orders, que si alcanza Postgres, apuntando a orders_db_test (nunca a orders_db):
//
//   docker compose exec -T orders sh -c \
//     'DATABASE_URL="${DATABASE_URL%/orders_db}/orders_db_test" node --test src/test/dashboard.db.check.js'
//
// Siembra un escenario conocido de 3 semanas, calcula lo esperado por su cuenta (bucles simples sobre los mismos
// datos) y lo compara con getDashboard; concilia cada dia con la vista previa del cierre de caja de Oscar; mide el
// tiempo con 92 dias de volumen. Vacia las tablas de orders_db_test al empezar y al terminar.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../config/prisma.js';
import { getCashClosePreview } from '../services/cashClose.service.js';
import { getDashboard } from '../services/dashboard.service.js';
import { listDays } from '../services/dashboardPeriod.js';

const W1 = randomUUID();
const W2 = randomUUID();
const W3 = randomUUID();
const ADMIN = randomUUID();
const PIZZA = randomUUID();
const AGUA = randomUUID();
const PASTA = randomUUID();
const PRICE = { [PIZZA]: 30000, [AGUA]: 3000, [PASTA]: 25000 };
const NAME = { [PIZZA]: 'Pizza Margarita', [AGUA]: 'Agua', [PASTA]: 'Pasta Carbonara' };

// Hora de Neiva -> instante. '2026-10-28 23:50' es 2026-10-29T04:50Z
const at = (local) => new Date(`${local.replace(' ', 'T')}:00-05:00`);
const bogotaDay = (d) => new Date(d.getTime() - 5 * 3600e3).toISOString().slice(0, 10);
const bogotaHour = (d) => new Date(d.getTime() - 5 * 3600e3).getUTCHours();
const MIN = 60e3;

async function wipe() {
  const [{ db }] = await prisma.$queryRaw`SELECT current_database() AS db`;
  assert.equal(db, 'orders_db_test', 'ABORTADO: este chequeo solo corre contra orders_db_test');
  await prisma.$executeRaw`TRUNCATE items, rounds, payments, qr_request_items, qr_requests, service_calls,
    cash_closure_payment_breakdown, cash_closure_top_products, cash_closure_waiter_breakdown, cash_closures,
    audit_log, orders, payment_methods, dining_tables`;
}

let tableSeq = 0;
let methods;
const seeded = []; // copia en memoria de lo sembrado, para calcular lo esperado sin SQL

// Una orden con sus rondas e items. `closedAt` null = orden abierta (ABIERTA o EN_COBRO).
async function order({
  openedBy,
  waiterId = openedBy,
  status = 'CERRADA',
  closedAt = null,
  method,
  discount = 0,
  rounds,
}) {
  const table = await prisma.diningTable.create({
    data: { tableNumber: 1000 + ++tableSeq, qrToken: `dash-${randomUUID()}` },
  });
  const firstRound = rounds[0].at;
  const o = await prisma.order.create({
    data: {
      tableId: table.tableId,
      openedBy,
      waiterId,
      status,
      openedAt: firstRound,
      closedAt,
      discountAmount: discount,
      discountAppliedBy: discount ? ADMIN : null,
      discountAppliedAt: discount ? firstRound : null,
    },
  });
  const record = { ...o, rounds: [], payment: null };
  for (const r of rounds) {
    const round = await prisma.round.create({
      data: { orderId: o.orderId, source: 'WAITER', createdBy: openedBy, createdAt: r.at },
    });
    for (const i of r.items) {
      const cancelled = i.status === 'cancelado';
      const item = await prisma.orderItem.create({
        data: {
          roundId: round.roundId,
          productId: i.product,
          productNameSnapshot: i.name ?? NAME[i.product],
          unitPriceSnapshot: PRICE[i.product],
          quantity: i.qty ?? 1,
          status: i.status ?? (closedAt ? 'entregado' : 'listo'),
          preparationStartedAt: cancelled ? null : r.at,
          readyAt: cancelled ? null : i.readyAt,
          deliveredAt: cancelled || !closedAt ? null : i.readyAt,
          cancelledBy: cancelled ? openedBy : null,
          cancelledReason: cancelled ? 'Prueba' : null,
          createdAt: r.at,
        },
      });
      record.rounds.push({ createdAt: r.at, item });
    }
  }
  if (status === 'CERRADA') {
    const subtotal = record.rounds
      .filter((x) => x.item.status !== 'cancelado')
      .reduce((s, x) => s + x.item.quantity * x.item.unitPriceSnapshot, 0);
    record.payment = await prisma.payment.create({
      data: {
        orderId: o.orderId,
        paymentMethodId: methods[method],
        subtotal,
        discountAmount: discount,
        total: subtotal - discount,
        discountAppliedBy: discount ? ADMIN : null,
        registeredBy: openedBy,
        paidAt: closedAt,
      },
    });
  }
  seeded.push(record);
  return record;
}

const served = (product, roundAt, minutes, extra = {}) => ({
  product,
  readyAt: new Date(roundAt.getTime() + minutes * MIN),
  ...extra,
});

// Lo esperado, calculado sin SQL sobre lo sembrado
function expected(from, to) {
  const days = new Set(listDays({ from, to }));
  const closed = seeded.filter((o) => o.status === 'CERRADA' && days.has(bogotaDay(o.closedAt)));
  const sales = closed.reduce((s, o) => s + o.payment.total, 0);
  const prep = seeded
    .flatMap((o) => o.rounds)
    .filter(
      (x) =>
        x.item.status !== 'cancelado' &&
        x.item.readyAt &&
        days.has(bogotaDay(x.item.readyAt)) &&
        x.item.readyAt >= x.createdAt,
    );
  const prepMinutes = prep.length
    ? Math.round(
        (prep.reduce((s, x) => s + (x.item.readyAt - x.createdAt), 0) / prep.length / MIN) * 10,
      ) / 10
    : null;
  const sumBy = (key) => {
    const m = new Map();
    for (const o of closed) m.set(key(o), (m.get(key(o)) ?? 0) + o.payment.total);
    return m;
  };
  return {
    sales,
    orders: closed.length,
    prepMinutes,
    prepItems: prep.length,
    byDay: sumBy((o) => bogotaDay(o.closedAt)),
    byHour: sumBy((o) => bogotaHour(o.closedAt)),
    byWaiter: sumBy((o) => o.openedBy),
    byMethod: sumBy((o) => o.payment.paymentMethodId),
  };
}

const asMap = (rows, key, value) =>
  new Map(rows.filter((r) => r[value] > 0).map((r) => [r[key], r[value]]));

before(async () => {
  await wipe();
  const cash = await prisma.paymentMethod.create({ data: { name: 'Efectivo', isCash: true } });
  const card = await prisma.paymentMethod.create({ data: { name: 'Tarjeta' } });
  methods = { cash: cash.paymentMethodId, card: card.paymentMethodId };

  // Semana del 19 al 25 de oct (periodo anterior) ------------------------------------------------------------
  await order({
    openedBy: W1,
    closedAt: at('2026-10-20 13:40'),
    method: 'cash',
    rounds: [
      {
        at: at('2026-10-20 13:00'),
        items: [served(PIZZA, at('2026-10-20 13:00'), 20, { qty: 2 })],
      },
    ],
  });
  await order({
    openedBy: W2,
    closedAt: at('2026-10-24 20:10'),
    method: 'card',
    rounds: [{ at: at('2026-10-24 19:30'), items: [served(PASTA, at('2026-10-24 19:30'), 16)] }],
  });
  // Ronda del domingo 25 a las 23:55 lista el lunes 26 a las 00:20: se mide el 26 (dia de su ready_at)
  await order({
    openedBy: W3,
    closedAt: at('2026-10-26 00:40'),
    method: 'cash',
    rounds: [{ at: at('2026-10-25 23:55'), items: [served(PIZZA, at('2026-10-25 23:55'), 25)] }],
  });

  // Semana del 26 oct al 1 nov (periodo consultado) ------------------------------------------------------------
  await order({
    openedBy: W1,
    closedAt: at('2026-10-27 13:30'),
    method: 'cash',
    rounds: [
      {
        at: at('2026-10-27 12:50'),
        items: [
          served(PIZZA, at('2026-10-27 12:50'), 18, { qty: 2 }),
          served(AGUA, at('2026-10-27 12:50'), 2, { qty: 3 }),
          { product: PASTA, status: 'cancelado' }, // cancelado: ni venta ni preparacion
        ],
      },
    ],
  });
  // Reasignada: abrio W1, hoy la atiende W2 -> la venta sigue en W1. Con descuento: ventas = lo cobrado.
  await order({
    openedBy: W1,
    waiterId: W2,
    closedAt: at('2026-10-28 14:15'),
    method: 'card',
    discount: 6000,
    rounds: [
      {
        at: at('2026-10-28 13:30'),
        items: [served(PASTA, at('2026-10-28 13:30'), 14, { qty: 2 })],
      },
    ],
  });
  // 23:50 del 28 en Neiva (04:50 UTC del 29): es del 28, hora 23
  await order({
    openedBy: W2,
    closedAt: at('2026-10-28 23:50'),
    method: 'cash',
    rounds: [{ at: at('2026-10-28 23:00'), items: [served(PIZZA, at('2026-10-28 23:00'), 22)] }],
  });
  // 00:10 del 29 en Neiva: es del 29, hora 0
  await order({
    openedBy: W3,
    closedAt: at('2026-10-29 00:10'),
    method: 'card',
    rounds: [{ at: at('2026-10-28 23:40'), items: [served(AGUA, at('2026-10-28 23:40'), 3)] }],
  });
  // Nombre del snapshot cambiado despues: el top usa el mas reciente
  await order({
    openedBy: W2,
    closedAt: at('2026-11-01 21:00'),
    method: 'cash',
    rounds: [
      {
        at: at('2026-11-01 20:00'),
        items: [served(PIZZA, at('2026-11-01 20:00'), 30, { name: 'Pizza Margarita (nueva)' })],
      },
    ],
  });
  // Item incoherente: ready_at antes de su ronda -> no se mide
  await order({
    openedBy: W3,
    closedAt: at('2026-10-30 19:00'),
    method: 'cash',
    rounds: [{ at: at('2026-10-30 18:30'), items: [served(AGUA, at('2026-10-30 18:30'), -5)] }],
  });
  // Ordenes abiertas: NO suman ventas, SI se mide su cocina
  await order({
    openedBy: W1,
    status: 'ABIERTA',
    rounds: [{ at: at('2026-10-31 19:00'), items: [served(PASTA, at('2026-10-31 19:00'), 10)] }],
  });
  await order({
    openedBy: W2,
    status: 'EN_COBRO',
    rounds: [{ at: at('2026-10-31 20:00'), items: [served(PIZZA, at('2026-10-31 20:00'), 12)] }],
  });

  // Semana del 2 al 8 de nov: fuera de ambos periodos
  await order({
    openedBy: W1,
    closedAt: at('2026-11-02 13:00'),
    method: 'cash',
    rounds: [
      {
        at: at('2026-11-02 12:30'),
        items: [served(PIZZA, at('2026-11-02 12:30'), 15, { qty: 5 })],
      },
    ],
  });

  // El metodo con pagos se renombra y desactiva despues: el historico no cambia
  await prisma.paymentMethod.update({
    where: { paymentMethodId: methods.card },
    data: { name: 'Tarjeta (vieja)', isActive: false },
  });
});

after(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('dashboard contra PostgreSQL (orders_db_test)', () => {
  const FROM = '2026-10-26';
  const TO = '2026-11-01';

  it('KPIs, series y desgloses iguales a lo calculado a mano sobre los datos sembrados', async () => {
    const d = await getDashboard({ from: FROM, to: TO });
    const e = expected(FROM, TO);
    const p = expected('2026-10-19', '2026-10-25');

    assert.deepEqual(d.previousPeriod, { from: '2026-10-19', to: '2026-10-25' });
    assert.equal(d.kpis.sales.value, e.sales);
    assert.equal(d.kpis.sales.previous, p.sales);
    assert.equal(d.kpis.orders.value, e.orders);
    assert.equal(d.kpis.orders.previous, p.orders);
    assert.equal(d.kpis.averageTicket.value, Math.round(e.sales / e.orders));
    assert.equal(d.kpis.preparationMinutes.value, e.prepMinutes);
    assert.equal(d.kpis.preparationMinutes.previous, p.prepMinutes);
    assert.equal(d.preparation.itemsMeasured, e.prepItems);

    assert.deepEqual(asMap(d.salesByDay, 'date', 'totalSales'), e.byDay);
    assert.deepEqual(asMap(d.salesByHour, 'hour', 'totalSales'), e.byHour);
    assert.deepEqual(asMap(d.waiterBreakdown, 'waiterId', 'totalAmount'), e.byWaiter);
    assert.deepEqual(asMap(d.paymentBreakdown, 'paymentMethodId', 'totalAmount'), e.byMethod);
    assert.equal(d.salesByDay.length, 7);
    assert.equal(d.salesByHour.length, 24);
  });

  it('cifras clave a mano: fronteras de medianoche, reasignacion, descuento, cancelados y top', async () => {
    const d = await getDashboard({ from: FROM, to: TO });
    const day = (date) => d.salesByDay.find((x) => x.date === date);
    // 28: 44.000 (2 pastas = 50.000 - 6.000 de descuento) + 30.000 de las 23:50
    assert.deepEqual(day('2026-10-28'), { date: '2026-10-28', totalSales: 74000, orders: 2 });
    // 29: solo la de las 00:10 (3.000)
    assert.deepEqual(day('2026-10-29'), { date: '2026-10-29', totalSales: 3000, orders: 1 });
    // Hora 23: la de las 23:50. Hora 0: la de las 00:10 (3.000) y la de las 00:40 del 26 (30.000)
    assert.equal(d.salesByHour[23].totalSales, 30000);
    assert.equal(d.salesByHour[0].totalSales, 33000);
    // 26: la que se cerro a las 00:40 (30.000)
    assert.equal(day('2026-10-26').totalSales, 30000);
    // Ventas: 30.000 + 69.000 + 44.000 + 30.000 + 3.000 + 30.000 + 3.000 = 209.000 en 7 cuentas
    assert.equal(d.kpis.sales.value, 209000);
    assert.equal(d.kpis.orders.value, 7);
    assert.equal(d.kpis.averageTicket.value, 29857); // 29.857,14
    // Anterior: 60.000 + 25.000 en 2 cuentas; preparacion (20 + 16) / 2 = 18
    assert.deepEqual(d.kpis.sales, { value: 209000, previous: 85000, changePercent: 145.9 });
    assert.equal(d.kpis.preparationMinutes.previous, 18);
    // W1 abrio la reasignada: 69.000 + 44.000
    assert.equal(d.waiterBreakdown.find((w) => w.waiterId === W1).totalAmount, 113000);
    // Top: Pizza 5 u. (1 + 2 + 1 + 1) y Agua 5 u. (3 + 1 + 1, la incoherente tambien se vendio) empatan en
    // unidades: gana Pizza por ingreso bruto. Pizza con el snapshot mas reciente. La pasta cancelada no cuenta.
    assert.deepEqual(
      d.topProducts.map((t) => [t.productName, t.quantitySold, t.revenue]),
      [
        ['Pizza Margarita (nueva)', 5, 150000],
        ['Agua', 5, 15000],
        ['Pasta Carbonara', 2, 50000],
      ],
    );
    // Preparacion del periodo: 25 (cruza la medianoche) + 18 + 2 + 14 + 22 + 3 + 30 + 10 + 12 = 136 / 9 = 15,1
    assert.equal(d.preparation.itemsMeasured, 9);
    assert.equal(d.kpis.preparationMinutes.value, 15.1);
  });

  it('conciliacion: cada dia del dashboard es igual a la vista previa del cierre de caja de ese dia', async () => {
    const d = await getDashboard({ from: FROM, to: TO });
    const methodTotals = new Map();
    const waiterTotals = new Map();
    for (const row of d.salesByDay) {
      const close = await getCashClosePreview(row.date);
      assert.equal(row.totalSales, close.totalSales, `ventas del ${row.date}`);
      assert.equal(row.orders, close.tablesServed, `cuentas del ${row.date}`);
      for (const m of close.paymentBreakdown) {
        methodTotals.set(
          m.paymentMethodId,
          (methodTotals.get(m.paymentMethodId) ?? 0) + m.totalAmount,
        );
      }
      for (const w of close.waiterBreakdown) {
        waiterTotals.set(w.waiterId, (waiterTotals.get(w.waiterId) ?? 0) + w.totalAmount);
      }
    }
    assert.deepEqual(asMap(d.paymentBreakdown, 'paymentMethodId', 'totalAmount'), methodTotals);
    assert.deepEqual(asMap(d.waiterBreakdown, 'waiterId', 'totalAmount'), waiterTotals);
  });

  it('periodo sin ventas: ceros y series completas', async () => {
    const d = await getDashboard({ from: '2026-12-01', to: '2026-12-07' });
    assert.equal(d.kpis.sales.value, 0);
    assert.equal(d.kpis.sales.changePercent, null);
    assert.equal(d.kpis.preparationMinutes.value, null);
    assert.equal(d.salesByDay.length, 7);
    assert.ok(d.salesByDay.every((x) => x.totalSales === 0));
  });

  it('rendimiento: 92 dias con volumen realista responde en menos de 2 s', async () => {
    // 92 dias x 50 cuentas x 4 items, en lote
    const days = listDays({ from: '2026-01-01', to: '2026-04-02' });
    const table = await prisma.diningTable.create({
      data: { tableNumber: 9999, qrToken: `dash-vol-${randomUUID()}` },
    });
    const orders = [];
    const payments = [];
    const rounds = [];
    const items = [];
    for (const day of days) {
      for (let n = 0; n < 50; n++) {
        const orderId = randomUUID();
        const roundId = randomUUID();
        const open = at(
          `${day} ${String(11 + (n % 11)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`,
        );
        const close = new Date(open.getTime() + 50 * MIN);
        orders.push({
          orderId,
          tableId: table.tableId,
          openedBy: [W1, W2, W3][n % 3],
          waiterId: W1,
          status: 'CERRADA',
          openedAt: open,
          closedAt: close,
        });
        rounds.push({ roundId, orderId, source: 'WAITER', createdBy: W1, createdAt: open });
        let subtotal = 0;
        for (const product of [PIZZA, AGUA, PASTA, PIZZA]) {
          subtotal += PRICE[product];
          items.push({
            roundId,
            productId: product,
            productNameSnapshot: NAME[product],
            unitPriceSnapshot: PRICE[product],
            quantity: 1,
            status: 'entregado',
            preparationStartedAt: open,
            readyAt: new Date(open.getTime() + (10 + (n % 15)) * MIN),
            deliveredAt: close,
            createdAt: open,
          });
        }
        payments.push({
          orderId,
          paymentMethodId: n % 2 ? methods.cash : methods.card,
          subtotal,
          total: subtotal,
          registeredBy: W1,
          paidAt: close,
        });
      }
    }
    await prisma.order.createMany({ data: orders });
    await prisma.round.createMany({ data: rounds });
    await prisma.orderItem.createMany({ data: items });
    await prisma.payment.createMany({ data: payments });

    await getDashboard({ from: days[0], to: days.at(-1) }); // calienta conexiones
    const t0 = performance.now();
    const d = await getDashboard({ from: days[0], to: days.at(-1) });
    const ms = performance.now() - t0;
    console.log(
      `  volumen: ${orders.length} cuentas, ${items.length} items, 92 + 92 dias -> ${ms.toFixed(0)} ms`,
    );

    assert.equal(d.kpis.orders.value, orders.length);
    assert.equal(
      d.kpis.sales.value,
      payments.reduce((s, p) => s + p.total, 0),
    );
    assert.ok(ms < 2000, `tardo ${ms.toFixed(0)} ms`);

    const plan = await prisma.$queryRaw`EXPLAIN (ANALYZE, FORMAT TEXT)
      SELECT count(*) FROM orders o JOIN payments p ON p.order_id = o.order_id
      WHERE o.status = 'CERRADA' AND o.closed_at >= ${new Date('2026-01-01T05:00:00Z')} AND o.closed_at < ${new Date('2026-04-03T05:00:00Z')}`;
    console.log(plan.map((r) => `  ${r['QUERY PLAN']}`).join('\n'));
  });
});
