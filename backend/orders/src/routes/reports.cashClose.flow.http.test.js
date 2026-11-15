// GC-153. Vista previa del cierre de caja (HU GC-RPT-0001), "con ordenes" y "sin ordenes", de punta a punta: la
// aplicacion real (ruta, JWT, validacion, rango del dia, calculo) con una base en memoria que FILTRA por el rango
// como lo hace la consulta real. Asi se comprueba lo que las pruebas aisladas no pueden: que cada dia trae SOLO sus
// ordenes (limites de medianoche, cierres de la noche que en UTC ya son el dia siguiente), que ninguna orden se
// cuenta dos veces ni se pierde entre dias contiguos, y que los datos son en vivo.
// Cada pieza tiene su prueba (cashClose, businessDay, reports.repository, reports.cashClose.http); el WHERE real
// se verifico contra PostgreSQL al implementarlo (ver el commit a6a7376).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { call, startApp, tokenFor } from '../test/helpers.js';

const h = vi.hoisted(() => {
  const db = { orders: [] };
  // Misma regla que reports.repository.js: orden CERRADA con closedAt en [start, end)
  const inDay = (o, { start, end }) =>
    o.status === 'CERRADA' && o.closedAt >= start && o.closedAt < end;
  const repo = {
    findPaymentsOfDay: async (range) =>
      db.orders
        .filter((o) => inDay(o, range) && o.payment)
        .map((o) => ({
          total: o.payment.total,
          paymentMethodId: o.payment.paymentMethodId,
          order: { openedBy: o.openedBy },
        })),
    // Los items de esas ordenes, sin los cancelados
    findSoldItemsOfDay: async (range) =>
      db.orders
        .filter((o) => inDay(o, range))
        .flatMap((o) => o.items.filter((i) => i.status !== 'cancelado')),
  };
  return { db, repo };
});

vi.mock('../config/prisma.js', () => ({ prisma: {} }));
vi.mock('../repositories/reports.repository.js', () => ({
  findPaymentsOfDay: (...a) => h.repo.findPaymentsOfDay(...a),
  findSoldItemsOfDay: (...a) => h.repo.findSoldItemsOfDay(...a),
}));

const CASH = '11111111-1111-4111-8111-111111111111';
const CARD = '22222222-2222-4222-8222-222222222222';
const W1 = '33333333-3333-4333-8333-333333333333';
const W2 = '44444444-4444-4444-8444-444444444444';
const PIZZA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PASTA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LIMO = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TIRA = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const line = (productId, name, price, quantity, status = 'entregado') => ({
  productId,
  productNameSnapshot: name,
  unitPriceSnapshot: price,
  quantity,
  status,
  createdAt: new Date('2026-11-14T15:00:00Z'),
});
const pizza = (q, s) => line(PIZZA, 'Pizza Margarita', 28000, q, s);
const pasta = (q, s) => line(PASTA, 'Pasta Carbonara', 25000, q, s);
const limo = (q, s) => line(LIMO, 'Limonada Natural', 8000, q, s);
const tira = (q, s) => line(TIRA, 'Tiramisú', 15000, q, s);

let seq = 0;
const order = ({ closedAt, status = 'CERRADA', openedBy = W1, method, total, items }) => ({
  orderId: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
  status,
  closedAt: closedAt ? new Date(closedAt) : null,
  openedBy,
  payment: total === undefined ? null : { total, paymentMethodId: method },
  items,
});

// Dia 14-nov-2026 en Colombia = [2026-11-14T05:00Z, 2026-11-15T05:00Z)
function seedDays() {
  h.db.orders = [
    // Del 14: la de la manana, la de las 8:30 p. m. (01:30 UTC del 15) y la de las 00:00 exactas (limite inferior)
    order({
      closedAt: '2026-11-14T13:30:00Z',
      openedBy: W1,
      method: CASH,
      total: 44000,
      items: [pizza(1), limo(2)],
    }),
    order({
      closedAt: '2026-11-15T01:30:00Z',
      openedBy: W2,
      method: CARD,
      total: 58000,
      // El tiramisu se anulo: no cuenta en el top, y el cobro ya no lo incluye
      items: [pasta(2), limo(1), tira(3, 'cancelado')],
    }),
    order({
      closedAt: '2026-11-14T05:00:00Z',
      openedBy: W1,
      method: CARD,
      total: 32000,
      items: [limo(4)],
    }),
    // Del 13: un segundo antes de las 00:00 del 14. Del 15: justo a medianoche (limite superior, ya es otro dia)
    order({
      closedAt: '2026-11-14T04:59:59Z',
      openedBy: W1,
      method: CASH,
      total: 252000,
      items: [pizza(9)],
    }),
    order({
      closedAt: '2026-11-15T05:00:00Z',
      openedBy: W2,
      method: CASH,
      total: 252000,
      items: [pizza(9)],
    }),
    // Sin cerrar: nunca entran a un cierre
    order({ status: 'ABIERTA', items: [pizza(5)] }),
    order({ status: 'EN_COBRO', items: [pizza(5)] }),
  ];
}

let app;
const preview = (date, token = tokenFor('ADMIN')) =>
  call(app.base, 'GET', `/api/orders/reports/cash-close?date=${date}`, { token });

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  seq = 0;
  seedDays();
});

describe('criterio 1: con ordenes cerradas en la fecha', () => {
  it('consolida el 14-nov con sus tres ordenes: ventas, mesas, ticket, desglose, top 5 y meseros', async () => {
    const res = await preview('2026-11-14');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      date: '2026-11-14',
      totalSales: 134000, // 44.000 + 58.000 + 32.000
      tablesServed: 3,
      averageTicket: 44667, // 134.000 / 3 = 44.666,67 redondeado
      paymentBreakdown: [
        { paymentMethodId: CARD, totalAmount: 90000, paymentCount: 2 },
        { paymentMethodId: CASH, totalAmount: 44000, paymentCount: 1 },
      ],
      topProducts: [
        { rank: 1, productId: LIMO, productName: 'Limonada Natural', quantitySold: 7 },
        { rank: 2, productId: PASTA, productName: 'Pasta Carbonara', quantitySold: 2 },
        { rank: 3, productId: PIZZA, productName: 'Pizza Margarita', quantitySold: 1 },
      ],
      waiterBreakdown: [
        { waiterId: W1, totalAmount: 76000 },
        { waiterId: W2, totalAmount: 58000 },
      ],
    });
  });

  it('la cuenta cerrada a las 8:30 p. m. (01:30 UTC del dia siguiente) es del dia del restaurante', async () => {
    const day14 = await preview('2026-11-14');
    const day15 = await preview('2026-11-15');
    expect(day14.body.waiterBreakdown.map((w) => w.waiterId)).toContain(W2);
    // El 15 solo tiene la de las 00:00 exactas, no la de las 8:30 p. m. del 14
    expect(day15.body.totalSales).toBe(252000);
  });

  it('el limite del dia: las 00:00 exactas entran al dia que empieza y 23:59:59 es del anterior', async () => {
    const day13 = await preview('2026-11-13');
    const day14 = await preview('2026-11-14');
    const day15 = await preview('2026-11-15');
    expect(day13.body.totalSales).toBe(252000); // la de 04:59:59Z
    expect(day14.body.totalSales).toBe(134000); // incluye la de 05:00:00Z exactas (limite inferior)
    expect(day15.body.totalSales).toBe(252000); // la de 05:00:00Z del 15 abre ese dia, no cierra el 14
  });

  it('un item anulado no cuenta en el top de platos', async () => {
    const { body } = await preview('2026-11-14');
    expect(body.topProducts.map((p) => p.productId)).not.toContain(TIRA);
  });

  it('las ordenes abiertas o en cobro no entran, ni siquiera sus items', async () => {
    const { body } = await preview('2026-11-14');
    // Las dos abiertas tienen 5 pizzas cada una: si entraran, la pizza seria la mas vendida
    expect(body.topProducts[0].productId).toBe(LIMO);
    expect(body.tablesServed).toBe(3);
  });

  it('dias contiguos: ninguna orden se cuenta dos veces ni se pierde (la suma es todo lo cerrado)', async () => {
    const days = await Promise.all(
      ['2026-11-13', '2026-11-14', '2026-11-15'].map((d) => preview(d)),
    );
    const sales = days.reduce((sum, r) => sum + r.body.totalSales, 0);
    const tables = days.reduce((sum, r) => sum + r.body.tablesServed, 0);
    const closed = h.db.orders.filter((o) => o.status === 'CERRADA');
    expect(sales).toBe(closed.reduce((sum, o) => sum + o.payment.total, 0));
    expect(tables).toBe(closed.length);
  });

  it('el desglose por metodo y por mesero suman exactamente el total de ventas', async () => {
    const { body } = await preview('2026-11-14');
    expect(body.paymentBreakdown.reduce((s, r) => s + r.totalAmount, 0)).toBe(body.totalSales);
    expect(body.waiterBreakdown.reduce((s, r) => s + r.totalAmount, 0)).toBe(body.totalSales);
    expect(body.paymentBreakdown.reduce((s, r) => s + r.paymentCount, 0)).toBe(body.tablesServed);
  });

  it('el top 5 trae como mucho cinco platos aunque se hayan vendido mas', async () => {
    h.db.orders.push(
      order({
        closedAt: '2026-11-14T18:00:00Z',
        method: CASH,
        total: 10000,
        items: Array.from({ length: 8 }, (_, i) =>
          line(`eeeeeeee-eeee-4eee-8eee-00000000000${i}`, `Plato ${i}`, 1000, 20 + i),
        ),
      }),
    );
    const { body } = await preview('2026-11-14');
    expect(body.topProducts).toHaveLength(5);
    expect(body.topProducts.map((p) => p.rank)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('criterio 2: sin ordenes cerradas en la fecha', () => {
  const EMPTY = (date) => ({
    date,
    totalSales: 0,
    tablesServed: 0,
    averageTicket: 0,
    paymentBreakdown: [],
    topProducts: [],
    waiterBreakdown: [],
  });

  it('un dia sin cierres responde 200 con ceros y listas vacias (no es un error)', async () => {
    const res = await preview('2026-11-20');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(EMPTY('2026-11-20'));
  });

  it('un dia que solo tiene ordenes abiertas tampoco tiene nada para cerrar', async () => {
    // Las ordenes abiertas existen en la base, pero ningun dia las cuenta hasta que se cierren
    expect(h.db.orders.some((o) => o.status !== 'CERRADA')).toBe(true);
    expect((await preview('2026-11-16')).body).toEqual(EMPTY('2026-11-16'));
  });

  it('un dia futuro lejano o muy antiguo tambien responde vacio', async () => {
    expect((await preview('2035-01-01')).body).toEqual(EMPTY('2035-01-01'));
    expect((await preview('2020-01-01')).body).toEqual(EMPTY('2020-01-01'));
  });

  it('el aviso vale para el dia exacto: el dia anterior a uno con ventas sigue vacio', async () => {
    h.db.orders = [
      order({ closedAt: '2026-11-14T13:30:00Z', method: CASH, total: 20000, items: [pizza(1)] }),
    ];
    expect((await preview('2026-11-13')).body.tablesServed).toBe(0);
    expect((await preview('2026-11-14')).body.tablesServed).toBe(1);
  });
});

describe('los datos son en vivo', () => {
  it('al cerrarse una orden, un dia que estaba vacio deja de estarlo', async () => {
    expect((await preview('2026-11-16')).body.tablesServed).toBe(0);

    const open = h.db.orders.find((o) => o.status === 'ABIERTA');
    Object.assign(open, {
      status: 'CERRADA',
      closedAt: new Date('2026-11-16T20:00:00Z'),
      payment: { total: 140000, paymentMethodId: CASH },
    });

    const after = await preview('2026-11-16');
    expect(after.body.tablesServed).toBe(1);
    expect(after.body.totalSales).toBe(140000);
    expect(after.body.topProducts[0]).toMatchObject({ productId: PIZZA, quantitySold: 5 });
  });

  it('consultar dos veces el mismo dia da el mismo resultado (solo lectura)', async () => {
    const first = await preview('2026-11-14');
    const second = await preview('2026-11-14');
    expect(second.body).toEqual(first.body);
    expect(h.db.orders).toHaveLength(7);
  });
});

describe('quien puede verlo', () => {
  it('solo el ADMIN: con ventas ese dia, un mesero y un cocinero reciben 403 y no ven cifras', async () => {
    for (const role of ['WAITER', 'COOK']) {
      const res = await preview('2026-11-14', tokenFor(role));
      expect(res.status).toBe(403);
      expect(res.body).not.toHaveProperty('totalSales');
    }
  });

  it('sin sesion responde 401', async () => {
    expect((await preview('2026-11-14', null)).status).toBe(401);
  });
});
