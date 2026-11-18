// GC-RPT-0003 (GC-188). Verificacion del historial de ventas contra PostgreSQL REAL, en la base aislada
// orders_db_test (nunca orders_db). No es un test de vitest (no termina en .test.js): corre con el runner nativo de
// Node dentro del contenedor de orders:
//
//   docker compose exec -T orders sh -c \
//     'DATABASE_URL="${DATABASE_URL%/orders_db}/orders_db_test" node --test src/test/history.db.check.js'
//
// Comprueba el SQL que los mocks no pueden: rango de dias de negocio, filtros, orden y desempate, paginacion
// estable, unidades sin cancelados, y que el resumen coincide con el cierre de caja del mismo dia.
// Vacia las tablas al empezar y al terminar.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { prisma } from '../config/prisma.js';
import { getCashClosePreview } from '../services/cashClose.service.js';
import { getSalesHistory, getSalesHistoryOrder } from '../services/history.service.js';
import { exportSalesHistory } from '../services/historyExport.service.js';

const W1 = randomUUID();
const W2 = randomUUID();
const PIZZA = randomUUID();
const AGUA = randomUUID();
const MIN = 60e3;
const at = (local) => new Date(`${local.replace(' ', 'T')}:00-05:00`);
const NOW = at('2026-11-14 21:00'); // "hoy" para la consulta sin fechas

async function wipe() {
  const [{ db }] = await prisma.$queryRaw`SELECT current_database() AS db`;
  assert.equal(db, 'orders_db_test', 'ABORTADO: este chequeo solo corre contra orders_db_test');
  await prisma.$executeRaw`TRUNCATE items, rounds, payments, qr_request_items, qr_requests, service_calls,
    cash_closure_payment_breakdown, cash_closure_top_products, cash_closure_waiter_breakdown, cash_closures,
    audit_log, orders, payment_methods, dining_tables`;
}

let methods;
let tables;
const q = (extra = {}) => ({ page: 1, pageSize: 100, ...extra });

// Venta cerrada: unidades vendidas `sold` (Pizza a 30.000) y opcionalmente unidades canceladas (Agua a 3.000)
async function sale({
  table = 0,
  openedBy = W1,
  method = 'cash',
  closedAt,
  sold = 1,
  cancelled = 0,
  discount = 0,
  id,
}) {
  const subtotal = 30000 * sold;
  const order = await prisma.order.create({
    data: {
      ...(id && { orderId: id }),
      tableId: tables[table].tableId,
      openedBy,
      waiterId: openedBy,
      status: 'CERRADA',
      openedAt: new Date(closedAt.getTime() - 60 * MIN),
      closedAt,
      discountAmount: discount,
      discountAppliedBy: discount ? W1 : null,
      discountAppliedAt: discount ? closedAt : null,
    },
  });
  const round = await prisma.round.create({
    data: {
      orderId: order.orderId,
      source: 'WAITER',
      createdBy: openedBy,
      createdAt: order.openedAt,
    },
  });
  const when = order.openedAt;
  await prisma.orderItem.create({
    data: {
      roundId: round.roundId,
      productId: PIZZA,
      productNameSnapshot: 'Pizza',
      unitPriceSnapshot: 30000,
      quantity: sold,
      status: 'entregado',
      preparationStartedAt: when,
      readyAt: when,
      deliveredAt: when,
      createdAt: when,
    },
  });
  if (cancelled) {
    await prisma.orderItem.create({
      data: {
        roundId: round.roundId,
        productId: AGUA,
        productNameSnapshot: 'Agua',
        unitPriceSnapshot: 3000,
        quantity: cancelled,
        status: 'cancelado',
        cancelledBy: openedBy,
        cancelledReason: 'Prueba',
        createdAt: when,
      },
    });
  }
  await prisma.payment.create({
    data: {
      orderId: order.orderId,
      paymentMethodId: methods[method],
      subtotal,
      discountAmount: discount,
      discountAppliedBy: discount ? W1 : null,
      total: subtotal - discount,
      registeredBy: openedBy,
      paidAt: closedAt,
    },
  });
  return order;
}

before(async () => {
  await wipe();
  methods = {
    cash: (await prisma.paymentMethod.create({ data: { name: 'Efectivo', isCash: true } }))
      .paymentMethodId,
    card: (await prisma.paymentMethod.create({ data: { name: 'Tarjeta', isCash: false } }))
      .paymentMethodId,
  };
  tables = [];
  for (const n of [1, 2]) {
    tables.push(
      await prisma.diningTable.create({
        data: { tableNumber: 3000 + n, qrToken: `hist-${randomUUID()}` },
      }),
    );
  }

  // 13-nov: 1 venta. 14-nov: 5 ventas, incluidas la de medianoche exacta y la de las 23:59.
  await sale({ closedAt: at('2026-11-13 20:00'), sold: 1 });
  await sale({ closedAt: at('2026-11-14 00:00'), sold: 2, method: 'card' }); // limite inferior: es del 14
  await sale({ closedAt: at('2026-11-14 12:30'), sold: 1, cancelled: 2, table: 1, openedBy: W2 });
  await sale({ closedAt: at('2026-11-14 19:00'), sold: 3, discount: 10000 });
  await sale({ closedAt: at('2026-11-14 23:59'), sold: 1, method: 'card', openedBy: W2 });
  // 15-nov 00:00 exacto: ya NO es del 14 (limite exclusivo)
  await sale({ closedAt: at('2026-11-15 00:00'), sold: 1 });
  // Mesa abierta del 14 (sin pago): nunca aparece
  const open = await prisma.order.create({
    data: {
      tableId: tables[0].tableId,
      openedBy: W1,
      waiterId: W1,
      status: 'ABIERTA',
      openedAt: at('2026-11-14 20:00'),
    },
  });
  assert.ok(open.orderId);
});
after(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('GC-188: historial de ventas (BD real)', () => {
  it('sin fechas trae el dia de negocio actual, con los limites de medianoche bien puestos', async () => {
    const page = await getSalesHistory(q(), NOW);
    assert.equal(page.total, 4);
    const hours = page.items.map((i) => i.closedAt.toISOString());
    assert.ok(
      hours.includes(at('2026-11-14 00:00').toISOString()),
      'la de las 00:00 del 14 es del 14',
    );
    assert.ok(
      !hours.includes(at('2026-11-15 00:00').toISOString()),
      'la de las 00:00 del 15 no es del 14',
    );
  });

  it('el resumen coincide con el cierre de caja del mismo dia (ventas, cuentas y ticket)', async () => {
    const page = await getSalesHistory(q({ from: '2026-11-14', to: '2026-11-14' }), NOW);
    const close = await getCashClosePreview('2026-11-14');
    assert.equal(page.summary.totalSales, close.totalSales);
    assert.equal(page.summary.ordersCount, close.tablesServed);
    assert.equal(page.summary.averageTicket, close.averageTicket);
    assert.equal(page.summary.totalSales, 60000 + 30000 + (90000 - 10000) + 30000);
  });

  it('un rango de varios dias suma cada dia (13 + 14 = 5 ventas) y coincide con los cierres de esos dias', async () => {
    const page = await getSalesHistory(q({ from: '2026-11-13', to: '2026-11-14' }), NOW);
    const d13 = await getCashClosePreview('2026-11-13');
    const d14 = await getCashClosePreview('2026-11-14');
    assert.equal(page.total, 5);
    assert.equal(page.summary.totalSales, d13.totalSales + d14.totalSales);
  });

  it('orden: cierre mas reciente primero', async () => {
    const page = await getSalesHistory(q({ from: '2026-11-13', to: '2026-11-15' }), NOW);
    const times = page.items.map((i) => i.closedAt.getTime());
    assert.deepEqual(
      times,
      [...times].sort((a, b) => b - a),
    );
  });

  it('cada fila: referencia de 6 caracteres, numero de mesa, mesero que abrio, unidades SIN cancelados y montos del pago', async () => {
    const page = await getSalesHistory(
      q({ from: '2026-11-14', to: '2026-11-14', tableId: tables[1].tableId }),
      NOW,
    );
    assert.equal(page.items.length, 1);
    const row = page.items[0];
    assert.equal(row.reference, row.orderId.slice(0, 6).toUpperCase());
    assert.equal(row.tableNumber, 3002);
    assert.equal(row.waiterId, W2);
    assert.equal(row.itemsCount, 1, 'las 2 unidades canceladas no cuentan');
    assert.equal(row.total, 30000);

    const disc = (
      await getSalesHistory(q({ from: '2026-11-14', to: '2026-11-14' }), NOW)
    ).items.find((i) => i.discountAmount > 0);
    assert.deepEqual([disc.subtotal, disc.discountAmount, disc.total], [90000, 10000, 80000]);
  });

  it('filtros: mesero (quien abrio), mesa y metodo de pago; el resumen sigue al filtro', async () => {
    const byWaiter = await getSalesHistory(
      q({ from: '2026-11-14', to: '2026-11-14', waiterId: W2 }),
      NOW,
    );
    assert.equal(byWaiter.total, 2);
    assert.ok(byWaiter.items.every((i) => i.waiterId === W2));
    assert.equal(byWaiter.summary.totalSales, 60000);

    const byCard = await getSalesHistory(
      q({ from: '2026-11-14', to: '2026-11-14', paymentMethodId: methods.card }),
      NOW,
    );
    assert.equal(byCard.total, 2);
    assert.ok(byCard.items.every((i) => i.paymentMethodId === methods.card));
    assert.equal(byCard.summary.totalSales, 90000);

    const combined = await getSalesHistory(
      q({ from: '2026-11-14', to: '2026-11-14', waiterId: W2, paymentMethodId: methods.card }),
      NOW,
    );
    assert.equal(combined.total, 1);

    const none = await getSalesHistory(
      q({ from: '2026-11-14', to: '2026-11-14', waiterId: randomUUID() }),
      NOW,
    );
    assert.deepEqual(none.items, []);
    assert.deepEqual(none.summary, { totalSales: 0, ordersCount: 0, averageTicket: 0 });
  });

  it('paginacion: el resumen y el total son de TODO el filtro; las paginas no repiten ni pierden filas', async () => {
    const all = await getSalesHistory(q({ from: '2026-11-13', to: '2026-11-15' }), NOW);
    const seen = [];
    for (let page = 1; page <= 3; page++) {
      const p = await getSalesHistory(
        { from: '2026-11-13', to: '2026-11-15', page, pageSize: 2 },
        NOW,
      );
      assert.equal(p.total, all.total);
      assert.deepEqual(p.summary, all.summary);
      seen.push(...p.items.map((i) => i.orderId));
    }
    assert.deepEqual(
      seen,
      all.items.map((i) => i.orderId),
    );
    assert.equal(new Set(seen).size, seen.length);
  });

  it('desempate estable: dos ventas cerradas en el MISMO instante salen ordenadas por orderId', async () => {
    const same = at('2026-11-10 15:00');
    const a = await sale({ closedAt: same, id: 'ffffffff-0000-4000-8000-000000000001' });
    const b = await sale({ closedAt: same, id: '00000000-0000-4000-8000-0000000000aa' });
    const page = await getSalesHistory(q({ from: '2026-11-10', to: '2026-11-10' }), NOW);
    assert.deepEqual(
      page.items.map((i) => i.orderId),
      [b.orderId, a.orderId],
    );
    const p1 = await getSalesHistory(
      { from: '2026-11-10', to: '2026-11-10', page: 1, pageSize: 1 },
      NOW,
    );
    const p2 = await getSalesHistory(
      { from: '2026-11-10', to: '2026-11-10', page: 2, pageSize: 1 },
      NOW,
    );
    assert.deepEqual([p1.items[0].orderId, p2.items[0].orderId], [b.orderId, a.orderId]);
  });

  it('las mesas abiertas o en cobro nunca aparecen', async () => {
    const page = await getSalesHistory(q({ from: '2026-11-14', to: '2026-11-14' }), NOW);
    const ids = await prisma.order.findMany({
      where: { status: { not: 'CERRADA' } },
      select: { orderId: true },
    });
    for (const { orderId } of ids) assert.ok(!page.items.some((i) => i.orderId === orderId));
  });
});

describe('GC-189: detalle de una venta (BD real)', () => {
  it('hecho cuando: en TODAS las ventas las lineas suman el subtotal y total = subtotal - descuento', async () => {
    const page = await getSalesHistory(q({ from: '2026-11-01', to: '2026-11-30' }), NOW);
    assert.ok(page.items.length >= 6);
    for (const row of page.items) {
      const detail = await getSalesHistoryOrder(row.orderId);
      const sum = detail.lines.reduce((s, l) => s + l.lineTotal, 0);
      assert.equal(sum, detail.subtotal, `lineas != subtotal en ${detail.reference}`);
      assert.equal(detail.total, detail.subtotal - detail.discountAmount);
      for (const l of detail.lines) assert.equal(l.lineTotal, l.unitPrice * l.quantity);
      // El detalle repite exactamente la fila del listado
      const { lines, cashReceived, changeGiven, ...asRow } = detail;
      assert.ok(Array.isArray(lines) && cashReceived !== undefined && changeGiven !== undefined);
      assert.deepEqual(asRow, row);
    }
  });

  it('las lineas usan el snapshot R3 y NO incluyen los items cancelados', async () => {
    const [row] = (
      await getSalesHistory(
        q({ from: '2026-11-14', to: '2026-11-14', tableId: tables[1].tableId }),
        NOW,
      )
    ).items;
    const detail = await getSalesHistoryOrder(row.orderId);
    assert.deepEqual(detail.lines, [
      { productId: PIZZA, productName: 'Pizza', quantity: 1, unitPrice: 30000, lineTotal: 30000 },
    ]);
    assert.ok(!detail.lines.some((l) => l.productId === AGUA), 'el Agua cancelada no es una linea');
  });

  it('en efectivo trae recibido y cambio; con tarjeta van en null', async () => {
    const day = (await getSalesHistory(q({ from: '2026-11-14', to: '2026-11-14' }), NOW)).items;
    const cash = day.find((i) => i.discountAmount > 0); // 80.000 en efectivo
    await prisma.payment.update({
      where: { orderId: cash.orderId },
      data: { amountReceived: 100000, changeGiven: 20000 },
    });
    const withCash = await getSalesHistoryOrder(cash.orderId);
    assert.equal(withCash.cashReceived, 100000);
    assert.equal(withCash.changeGiven, 20000);

    const card = day.find((i) => i.paymentMethodId === methods.card);
    const withCard = await getSalesHistoryOrder(card.orderId);
    assert.equal(withCard.cashReceived, null);
    assert.equal(withCard.changeGiven, null);
  });

  it('una mesa abierta (todavia no es venta) o un id que no existe -> 404 ORDER_NOT_FOUND', async () => {
    const open = await prisma.order.findFirst({ where: { status: 'ABIERTA' } });
    await assert.rejects(getSalesHistoryOrder(open.orderId), {
      status: 404,
      code: 'ORDER_NOT_FOUND',
    });
    await assert.rejects(getSalesHistoryOrder(randomUUID()), {
      status: 404,
      code: 'ORDER_NOT_FOUND',
    });
  });
});

// GC-190. Genera el .xlsx con la base real y lo deja en /tmp para abrirlo con un lector de Excel independiente
// (openpyxl) desde fuera del contenedor: docker compose cp orders:/tmp/<archivo> .
describe('GC-190: exportacion a Excel (BD real)', () => {
  it('genera el archivo del rango con el nombre ventas_desde_hasta.xlsx y los datos del filtro', async () => {
    const query = { from: '2026-11-13', to: '2026-11-14' };
    const { fileName, buffer } = await exportSalesHistory(query, NOW);
    assert.equal(fileName, 'ventas_2026-11-13_2026-11-14.xlsx');
    assert.equal(buffer.subarray(0, 2).toString(), 'PK');
    writeFileSync(`/tmp/${fileName}`, buffer);

    // Lo que la pantalla mostraria para el mismo filtro: la verificacion de openpyxl lo compara con el archivo
    const page = await getSalesHistory(q(query), NOW);
    writeFileSync(
      '/tmp/ventas_esperado.json',
      JSON.stringify({ summary: page.summary, references: page.items.map((i) => i.reference) }),
    );
  });

  it('con un filtro sin ventas el archivo tiene solo el encabezado y totales en cero', async () => {
    const { fileName, buffer } = await exportSalesHistory(
      { from: '2026-11-14', to: '2026-11-14', waiterId: randomUUID() },
      NOW,
    );
    writeFileSync(`/tmp/vacio_${fileName}`, buffer);
    assert.ok(buffer.length > 0);
  });
});
