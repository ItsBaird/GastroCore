// GC-RPT-0003 (GC-191). Flujo HTTP del historial de ventas contra PostgreSQL REAL: la app de verdad (rutas, JWT,
// validacion, errores, servicios, repositorios y SQL) sobre la base aislada orders_db_test (nunca orders_db). No es
// un test de vitest (no termina en .test.js): corre con el runner nativo de Node dentro del contenedor de orders:
//
//   docker compose exec -T orders sh -c \
//     'DATABASE_URL="${DATABASE_URL%/orders_db}/orders_db_test" node --test src/test/history.http.db.check.js'
//
// Cubre: filtros (mesero = quien ABRIO, mesa, metodo, fechas), paginacion y total, orden, limites del rango,
// 400/401/403/404/422, cuentas no cerradas e items cancelados excluidos, limite de las 24:00 exclusivo,
// consistencia con GET /reports/cash-close, y la exportacion (cabeceras, contenido de la hoja y fila de totales).
// Vacia las tablas al empezar y al terminar.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import jwt from 'jsonwebtoken';

// Clave propia de este chequeo: el JWT se firma aqui y la app lo valida con la publica (antes de importar la app)
const keys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const keyDir = mkdtempSync(path.join(tmpdir(), 'history-check-'));
process.env.JWT_PUBLIC_KEY_PATH = path.join(keyDir, 'jwt_public.pem');
writeFileSync(process.env.JWT_PUBLIC_KEY_PATH, keys.publicKey);

const { prisma } = await import('../config/prisma.js');
const { default: app } = await import('../app.js');

const ADMIN = randomUUID();
const W1 = randomUUID();
const W2 = randomUUID();
const PIZZA = randomUUID();
const AGUA = randomUUID();
const MIN = 60e3;
const at = (local) => new Date(`${local.replace(' ', 'T')}:00-05:00`);
const tokenFor = (role, userId = ADMIN) =>
  jwt.sign({ role, permissions: [] }, keys.privateKey, {
    algorithm: 'RS256',
    subject: userId,
    expiresIn: 600,
  });

let server;
let base;
let methods;
let tables;
const ids = {};

async function request(url, { token = tokenFor('ADMIN'), raw = false } = {}) {
  const res = await fetch(`${base}${url}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const type = res.headers.get('content-type') ?? '';
  const body =
    raw && !type.includes('json')
      ? Buffer.from(await res.arrayBuffer())
      : await res.json().catch(() => null);
  return { status: res.status, headers: res.headers, body };
}
const list = (query = '') => request(`/api/orders/history${query}`);

async function wipe() {
  const [{ db }] = await prisma.$queryRaw`SELECT current_database() AS db`;
  assert.equal(db, 'orders_db_test', 'ABORTADO: este chequeo solo corre contra orders_db_test');
  await prisma.$executeRaw`TRUNCATE items, rounds, payments, qr_request_items, qr_requests, service_calls,
    cash_closure_payment_breakdown, cash_closure_top_products, cash_closure_waiter_breakdown, cash_closures,
    audit_log, orders, payment_methods, dining_tables`;
}

// Venta: `sold` Pizzas a 30.000 entregadas y `cancelled` Aguas a 3.000 canceladas. `status` distinto de CERRADA
// deja la mesa abierta o en cobro (sin pago). `waiterId` distinto de `openedBy` simula una mesa reasignada.
async function order({
  table = 0,
  openedBy = W1,
  waiterId = openedBy,
  status = 'CERRADA',
  method = 'cash',
  closedAt,
  sold = 1,
  cancelled = 0,
  discount = 0,
}) {
  const closed = status === 'CERRADA';
  const openedAt = new Date((closedAt ?? new Date()).getTime() - 60 * MIN);
  const o = await prisma.order.create({
    data: {
      tableId: tables[table].tableId,
      openedBy,
      waiterId,
      status,
      openedAt,
      closedAt: closed ? closedAt : null,
      discountAmount: discount,
      discountAppliedBy: discount ? ADMIN : null,
      discountAppliedAt: discount ? openedAt : null,
    },
  });
  const round = await prisma.round.create({
    data: { orderId: o.orderId, source: 'WAITER', createdBy: openedBy, createdAt: openedAt },
  });
  await prisma.orderItem.create({
    data: {
      roundId: round.roundId,
      productId: PIZZA,
      productNameSnapshot: 'Pizza',
      unitPriceSnapshot: 30000,
      quantity: sold,
      status: 'entregado',
      preparationStartedAt: openedAt,
      readyAt: openedAt,
      deliveredAt: openedAt,
      createdAt: openedAt,
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
        createdAt: openedAt,
      },
    });
  }
  if (closed) {
    const subtotal = 30000 * sold;
    await prisma.payment.create({
      data: {
        orderId: o.orderId,
        paymentMethodId: methods[method],
        subtotal,
        discountAmount: discount,
        discountAppliedBy: discount ? ADMIN : null,
        total: subtotal - discount,
        amountReceived: method === 'cash' ? subtotal - discount + 5000 : null,
        changeGiven: method === 'cash' ? 5000 : null,
        registeredBy: waiterId,
        paidAt: closedAt,
      },
    });
  }
  return o;
}

// Lee la hoja de un .xlsx (zip + XML) a una matriz de valores: texto (sharedStrings) o numero
function readSheet(buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  const strings = [...strFromU8(files['xl/sharedStrings.xml']).matchAll(/<si>(.*?)<\/si>/gs)].map(
    (m) => [...m[1].matchAll(/<t[^>]*>(.*?)<\/t>/gs)].map((t) => t[1]).join(''),
  );
  const decode = (s) =>
    s
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&amp;', '&');
  const rows = [];
  for (const [, r, inner] of strFromU8(files['xl/worksheets/sheet1.xml']).matchAll(
    /<row r="(\d+)"[^>]*>(.*?)<\/row>/gs,
  )) {
    const row = [];
    for (const [, col, attrs, v] of inner.matchAll(
      /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>(?:<v>(.*?)<\/v>)?<\/c>)/gs,
    )) {
      const index = col.charCodeAt(0) - 65;
      row[index] =
        v === undefined ? null : /t="s"/.test(attrs) ? decode(strings[Number(v)]) : Number(v);
    }
    rows[Number(r) - 1] = row;
  }
  const workbook = strFromU8(files['xl/workbook.xml']);
  return { rows, sheetName: workbook.match(/<sheet [^>]*name="([^"]+)"/)[1] };
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
        data: { tableNumber: 4000 + n, qrToken: `hhttp-${randomUUID()}` },
      }),
    );
  }

  // 13-nov
  ids.d13 = await order({ closedAt: at('2026-11-13 20:00') });
  // 14-nov: 00:00 exacto (limite inferior), con cancelados, con descuento, reasignada, y la de las 23:59
  ids.midnight = await order({ closedAt: at('2026-11-14 00:00'), sold: 2, method: 'card' });
  ids.cancelled = await order({
    closedAt: at('2026-11-14 12:30'),
    sold: 1,
    cancelled: 2,
    table: 1,
    openedBy: W2,
  });
  ids.discount = await order({ closedAt: at('2026-11-14 19:00'), sold: 3, discount: 10000 });
  ids.reassigned = await order({
    closedAt: at('2026-11-14 21:00'),
    openedBy: W1,
    waiterId: W2,
    method: 'card',
  });
  ids.late = await order({ closedAt: at('2026-11-14 23:59'), method: 'card', openedBy: W2 });
  // 15-nov 00:00 exacto: ya NO es del 14 (el fin del rango es exclusivo)
  ids.d15 = await order({ closedAt: at('2026-11-15 00:00') });
  // Cuentas NO cerradas: nunca son ventas
  ids.open = await order({ status: 'ABIERTA', table: 0 });
  ids.billing = await order({ status: 'EN_COBRO', table: 1 });

  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await wipe();
  await prisma.$disconnect();
});

const DAY14 = '?from=2026-11-14&to=2026-11-14';
// 14-nov: 60.000 + 30.000 + 80.000 + 30.000 + 30.000
const SALES14 = 230000;

describe('acceso (401/403)', () => {
  for (const url of [
    '/api/orders/history',
    '/api/orders/history/export',
    `/api/orders/history/${randomUUID()}`,
  ]) {
    it(`${url.replace(/[0-9a-f-]{36}/, ':orderId')}: sin sesion 401; WAITER y COOK 403`, async () => {
      assert.equal((await request(url, { token: null })).status, 401);
      assert.equal((await request(url, { token: tokenFor('WAITER', W1) })).status, 403);
      assert.equal((await request(url, { token: tokenFor('COOK') })).status, 403);
    });
  }
});

describe('listado: rango de dias y limites', () => {
  it('el 14 trae sus 5 ventas: incluye la de las 00:00 del 14 y excluye la de las 00:00 del 15', async () => {
    const { status, body } = await list(DAY14);
    assert.equal(status, 200);
    assert.equal(body.total, 5);
    const got = body.items.map((i) => i.orderId);
    assert.ok(got.includes(ids.midnight.orderId), 'la de las 00:00 del 14 es del 14');
    assert.ok(!got.includes(ids.d15.orderId), 'las 24:00 del 14 ya son el 15');
    assert.ok(!got.includes(ids.d13.orderId));
  });

  it('las cuentas abiertas o en cobro nunca aparecen', async () => {
    const { body } = await list('?from=2026-11-01&to=2026-11-30');
    const got = body.items.map((i) => i.orderId);
    assert.ok(!got.includes(ids.open.orderId));
    assert.ok(!got.includes(ids.billing.orderId));
    assert.equal(body.total, 7);
  });

  it('orden: el cierre mas reciente primero', async () => {
    const { body } = await list('?from=2026-11-13&to=2026-11-15');
    const times = body.items.map((i) => Date.parse(i.closedAt));
    assert.deepEqual(
      times,
      [...times].sort((a, b) => b - a),
    );
  });

  it('sin fechas trae el dia de negocio ACTUAL', async () => {
    const now = await order({ closedAt: new Date(Date.now() - MIN) });
    const { body } = await list();
    assert.ok(body.items.some((i) => i.orderId === now.orderId));
    await prisma.payment.delete({ where: { orderId: now.orderId } });
    await prisma.orderItem.deleteMany({ where: { round: { orderId: now.orderId } } });
    await prisma.round.deleteMany({ where: { orderId: now.orderId } });
    await prisma.order.delete({ where: { orderId: now.orderId } });
  });

  it('366 dias es el maximo (200); 367, from > to o una sola fecha -> 400 VALIDATION_ERROR', async () => {
    assert.equal((await list('?from=2026-01-01&to=2027-01-01')).status, 200);
    for (const q of [
      '?from=2026-01-01&to=2027-01-02',
      '?from=2026-11-15&to=2026-11-14',
      '?from=2026-11-14',
    ]) {
      const res = await list(q);
      assert.equal(res.status, 400, q);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    }
  });
});

describe('listado: filtros y resumen', () => {
  it('mesero = quien ABRIO la mesa: la venta reasignada cuenta para W1, no para W2', async () => {
    const w1 = (await list(`${DAY14}&waiterId=${W1}`)).body;
    const w2 = (await list(`${DAY14}&waiterId=${W2}`)).body;
    assert.ok(w1.items.some((i) => i.orderId === ids.reassigned.orderId));
    assert.ok(!w2.items.some((i) => i.orderId === ids.reassigned.orderId));
    assert.ok(w1.items.every((i) => i.waiterId === W1));
    assert.equal(w1.total + w2.total, 5);
    assert.equal(w1.summary.totalSales + w2.summary.totalSales, SALES14);
  });

  it('mesa y metodo de pago; el resumen sigue al filtro', async () => {
    const t2 = (await list(`${DAY14}&tableId=${tables[1].tableId}`)).body;
    assert.deepEqual(
      t2.items.map((i) => i.orderId),
      [ids.cancelled.orderId],
    );
    assert.equal(t2.items[0].tableNumber, 4002);

    const card = (await list(`${DAY14}&paymentMethodId=${methods.card}`)).body;
    assert.equal(card.total, 3);
    assert.ok(card.items.every((i) => i.paymentMethodId === methods.card));
    assert.equal(card.summary.totalSales, 60000 + 30000 + 30000);
  });

  it('un filtro sin coincidencias: lista vacia y resumen en ceros', async () => {
    const { body } = await list(`${DAY14}&waiterId=${randomUUID()}`);
    assert.deepEqual(body.items, []);
    assert.deepEqual(body.summary, { totalSales: 0, ordersCount: 0, averageTicket: 0 });
  });

  it('items cancelados excluidos: la venta con 2 Aguas canceladas cuenta 1 unidad', async () => {
    const { body } = await list(`${DAY14}&tableId=${tables[1].tableId}`);
    assert.equal(body.items[0].itemsCount, 1);
    assert.equal(body.items[0].total, 30000);
  });

  it('cada fila: referencia de 6 caracteres en mayusculas y montos del pago', async () => {
    const { body } = await list(DAY14);
    for (const i of body.items) {
      assert.equal(i.reference, i.orderId.slice(0, 6).toUpperCase());
      assert.equal(i.total, i.subtotal - i.discountAmount);
    }
  });
});

describe('listado: paginacion y total', () => {
  it('total y resumen son de TODO el filtro; las paginas no repiten ni pierden filas', async () => {
    const all = (await list('?from=2026-11-13&to=2026-11-15&pageSize=100')).body;
    const seen = [];
    for (let page = 1; page <= 4; page++) {
      const p = (await list(`?from=2026-11-13&to=2026-11-15&page=${page}&pageSize=2`)).body;
      assert.equal(p.total, all.total);
      assert.deepEqual(p.summary, all.summary);
      assert.equal(p.page, page);
      assert.equal(p.pageSize, 2);
      seen.push(...p.items.map((i) => i.orderId));
    }
    assert.deepEqual(
      seen,
      all.items.map((i) => i.orderId),
    );
  });

  it('pageSize > 100 o page 0 -> 400', async () => {
    assert.equal((await list('?pageSize=101')).status, 400);
    assert.equal((await list('?page=0')).status, 400);
  });
});

describe('consistencia con el cierre de caja (GET /reports/cash-close)', () => {
  for (const day of ['2026-11-13', '2026-11-14', '2026-11-15']) {
    it(`${day}: ventas, cuentas y ticket iguales a la vista previa del cierre`, async () => {
      const history = (await list(`?from=${day}&to=${day}`)).body.summary;
      const close = (await request(`/api/orders/reports/cash-close?date=${day}`)).body;
      assert.equal(history.totalSales, close.totalSales);
      assert.equal(history.ordersCount, close.tablesServed);
      assert.equal(history.averageTicket, close.averageTicket);
    });
  }

  it('un rango de varios dias suma los cierres de cada dia', async () => {
    const history = (await list('?from=2026-11-13&to=2026-11-15')).body.summary;
    let sum = 0;
    for (const day of ['2026-11-13', '2026-11-14', '2026-11-15']) {
      sum += (await request(`/api/orders/reports/cash-close?date=${day}`)).body.totalSales;
    }
    assert.equal(history.totalSales, sum);
  });
});

describe('detalle (200/400/404)', () => {
  it('lineas sin cancelados que suman el subtotal; efectivo con recibido y cambio', async () => {
    const { status, body } = await request(`/api/orders/history/${ids.cancelled.orderId}`);
    assert.equal(status, 200);
    assert.deepEqual(body.lines, [
      { productId: PIZZA, productName: 'Pizza', quantity: 1, unitPrice: 30000, lineTotal: 30000 },
    ]);
    assert.equal(
      body.lines.reduce((s, l) => s + l.lineTotal, 0),
      body.subtotal,
    );
    assert.equal(body.cashReceived, 35000);
    assert.equal(body.changeGiven, 5000);
  });

  it('una venta con tarjeta: recibido y cambio en null', async () => {
    const { body } = await request(`/api/orders/history/${ids.late.orderId}`);
    assert.equal(body.cashReceived, null);
    assert.equal(body.changeGiven, null);
  });

  it('cuenta abierta, en cobro o inexistente -> 404 ORDER_NOT_FOUND; id no UUID -> 400', async () => {
    for (const id of [ids.open.orderId, ids.billing.orderId, randomUUID()]) {
      const res = await request(`/api/orders/history/${id}`);
      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'ORDER_NOT_FOUND');
    }
    assert.equal((await request('/api/orders/history/no-es-uuid')).status, 400);
  });
});

describe('exportacion a Excel', () => {
  it('cabeceras: tipo xlsx, descarga con el nombre del rango y sin cache', async () => {
    const res = await request(`/api/orders/history/export${DAY14}`, { raw: true });
    assert.equal(res.status, 200);
    assert.equal(
      res.headers.get('content-type'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    assert.equal(
      res.headers.get('content-disposition'),
      'attachment; filename="ventas_2026-11-14_2026-11-14.xlsx"',
    );
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  it('contenido: hoja Ventas, las mismas ventas y orden del listado, y fila de totales = resumen', async () => {
    const page = (await list(`${DAY14}&pageSize=100`)).body;
    const { body } = await request(`/api/orders/history/export${DAY14}`, { raw: true });
    const { rows, sheetName } = readSheet(body);

    assert.equal(sheetName, 'Ventas');
    assert.deepEqual(rows[0], [
      'Referencia',
      'Fecha cierre',
      'Mesa',
      'Mesero',
      'Productos',
      'Subtotal',
      'Descuento',
      'Total',
      'Método de pago',
    ]);
    const data = rows.slice(1, -1);
    assert.deepEqual(
      data.map((r) => r[0]),
      page.items.map((i) => i.reference),
    );
    for (const [r, item] of data.map((r, i) => [r, page.items[i]])) {
      assert.equal(r[2], item.tableNumber);
      assert.equal(r[4], item.itemsCount);
      assert.deepEqual([r[5], r[6], r[7]], [item.subtotal, item.discountAmount, item.total]);
      assert.ok(['Efectivo', 'Tarjeta'].includes(r[8]));
    }
    const totals = rows.at(-1);
    assert.equal(totals[0], `Total (${page.summary.ordersCount} ventas)`);
    assert.equal(totals[7], page.summary.totalSales);
    assert.equal(totals[7], SALES14);
    assert.equal(
      totals[5],
      data.reduce((s, r) => s + r[5], 0),
    );
    assert.equal(
      totals[6],
      data.reduce((s, r) => s + r[6], 0),
    );
  });

  it('respeta los filtros: solo tarjeta', async () => {
    const { body } = await request(
      `/api/orders/history/export${DAY14}&paymentMethodId=${methods.card}`,
      {
        raw: true,
      },
    );
    const { rows } = readSheet(body);
    assert.equal(rows.length, 1 + 3 + 1);
    assert.ok(rows.slice(1, -1).every((r) => r[8] === 'Tarjeta'));
  });

  it('page o pageSize en la exportacion -> 400', async () => {
    assert.equal((await request(`/api/orders/history/export${DAY14}&page=1`)).status, 400);
  });

  it('mas de 10000 ventas -> 422 EXPORT_TOO_LARGE; el listado de esas mismas ventas si responde', async () => {
    // 10001 ventas en un dia aparte (2025-06-01), insertadas en bloque
    const closedAt = at('2025-06-01 12:00');
    const rows = Array.from({ length: 10001 }, () => ({
      orderId: randomUUID(),
      tableId: tables[0].tableId,
      openedBy: W1,
      waiterId: W1,
      status: 'CERRADA',
      openedAt: closedAt,
      closedAt,
    }));
    await prisma.order.createMany({ data: rows });
    await prisma.payment.createMany({
      data: rows.map((o) => ({
        orderId: o.orderId,
        paymentMethodId: methods.card,
        subtotal: 1000,
        total: 1000,
        registeredBy: W1,
        paidAt: closedAt,
      })),
    });

    const res = await request('/api/orders/history/export?from=2025-06-01&to=2025-06-01');
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'EXPORT_TOO_LARGE');
    // En development el manejador de errores agrega `stack` a details: se comparan solo los campos del contrato
    assert.equal(res.body.error.details.rows, 10001);
    assert.equal(res.body.error.details.max, 10000);

    const page = (await list('?from=2025-06-01&to=2025-06-01')).body;
    assert.equal(page.total, 10001);
    assert.equal(page.items.length, 20);
    assert.equal(page.summary.totalSales, 10001 * 1000);
  });
});
