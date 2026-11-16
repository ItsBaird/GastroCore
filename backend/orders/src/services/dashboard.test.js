import { describe, expect, it } from 'vitest';
import { buildCashClosePreview } from './cashClose.js';
import {
  averageTicket,
  buildDashboard,
  changePercent,
  fillDays,
  fillHours,
  rankTopProducts,
  round1,
  sortBreakdown,
  summarizePreparation,
} from './dashboard.js';

const P = (n) => `00000000-0000-4000-a000-00000000000${n}`;
const PIZZAS = { categoryId: 'c-pizzas', categoryName: 'Pizzas' };
const BEBIDAS = { categoryId: 'c-bebidas', categoryName: 'Bebidas' };

describe('dashboard: porcentajes y redondeos', () => {
  it('changePercent: sube, baja y sin anterior es null (nunca 0 % ni infinito)', () => {
    expect(changePercent(4250000, 3927000)).toBe(8.2);
    expect(changePercent(128, 132)).toBe(-3);
    expect(changePercent(5, 0)).toBeNull();
    expect(changePercent(0, 0)).toBeNull();
    expect(changePercent(null, 12.9)).toBeNull();
    expect(changePercent(12.4, null)).toBeNull();
    expect(changePercent(10, 10)).toBe(0);
  });

  it('round1 es simetrico para negativos y no deja -0', () => {
    expect(round1(-4.05)).toBe(-4.1);
    expect(round1(4.05)).toBe(4.1);
    expect(round1(-0.01)).toBe(0);
    expect(Object.is(round1(-0.01), -0)).toBe(false);
  });

  it('ticket promedio entero; 0 sin cuentas', () => {
    expect(averageTicket({ sales: 100000, orders: 3 })).toBe(33333);
    expect(averageTicket({ sales: 100001, orders: 2 })).toBe(50001);
    expect(averageTicket({ sales: 0, orders: 0 })).toBe(0);
  });
});

describe('dashboard: series completas', () => {
  it('un elemento por dia, con cero donde no hubo ventas', () => {
    const days = fillDays({ from: '2026-11-09', to: '2026-11-11' }, [
      { date: '2026-11-10', totalSales: 62000, orders: 1 },
    ]);
    expect(days).toEqual([
      { date: '2026-11-09', totalSales: 0, orders: 0 },
      { date: '2026-11-10', totalSales: 62000, orders: 1 },
      { date: '2026-11-11', totalSales: 0, orders: 0 },
    ]);
  });

  it('siempre 24 horas', () => {
    const hours = fillHours([{ hour: 13, totalSales: 50000, orders: 2 }]);
    expect(hours).toHaveLength(24);
    expect(hours[0]).toEqual({ hour: 0, totalSales: 0, orders: 0 });
    expect(hours[13]).toEqual({ hour: 13, totalSales: 50000, orders: 2 });
  });
});

describe('dashboard: top 5 con el mismo desempate que el cierre de caja', () => {
  // Agrupa items como la consulta soldProducts (unidades, ingreso bruto, nombre del snapshot mas reciente)
  const groupLikeSql = (items) => {
    const map = new Map();
    for (const i of items) {
      const g = map.get(i.productId) ?? {
        productId: i.productId,
        quantitySold: 0,
        revenue: 0,
        latest: -1,
      };
      g.quantitySold += i.quantity;
      g.revenue += i.quantity * i.unitPriceSnapshot;
      if (i.createdAt.getTime() > g.latest) {
        g.latest = i.createdAt.getTime();
        g.productName = i.productNameSnapshot;
      }
      map.set(i.productId, g);
    }
    return [...map.values()];
  };
  const item = (productId, productNameSnapshot, quantity, unitPriceSnapshot, minute = 0) => ({
    productId,
    productNameSnapshot,
    quantity,
    unitPriceSnapshot,
    createdAt: new Date(Date.UTC(2026, 10, 10, 18, minute)),
  });

  it('coincide con buildCashClosePreview: unidades, luego ingreso, luego nombre, luego id', () => {
    const items = [
      item(P(1), 'Pizza Margarita', 3, 28000),
      item(P(2), 'Agua', 3, 2000), // empata en unidades, pierde por ingreso
      item(P(3), 'Limonada', 2, 8000),
      item(P(4), 'Jugo', 2, 8000), // empata en unidades e ingreso: "Jugo" va antes que "Limonada"
      item(P(5), 'Ñame frito', 1, 9000),
      item(P(6), 'Nachos', 1, 9000), // empata: "Nachos" antes que "Ñame" en espanol
      item(P(7), 'Pizza Pepperoni', 1, 32000, 1),
      item(P(7), 'Pizza Peperoni (nuevo nombre)', 1, 32000, 5), // gana el snapshot mas reciente
    ];
    const ours = rankTopProducts(groupLikeSql(items));
    const oscars = buildCashClosePreview({ date: '2026-11-10', payments: [], items }).topProducts;

    expect(ours.map((p) => [p.rank, p.productId, p.productName, p.quantitySold])).toEqual(
      oscars.map((p) => [p.rank, p.productId, p.productName, p.quantitySold]),
    );
    expect(ours).toHaveLength(5);
    expect(ours[0]).toEqual({
      rank: 1,
      productId: P(1),
      productName: 'Pizza Margarita',
      quantitySold: 3,
      revenue: 84000,
    });
  });

  it('sin ventas, lista vacia', () => {
    expect(rankTopProducts([])).toEqual([]);
  });
});

describe('dashboard: preparacion', () => {
  const rows = [
    { productId: P(1), items: 2, seconds: 2 * 15 * 60 }, // 15 min c/u
    { productId: P(2), items: 1, seconds: 3 * 60 }, // 3 min
    { productId: P(3), items: 1, seconds: 12 * 60 }, // producto que ya no existe en Catalog
  ];

  it('promedio global por item (ponderado), en minutos con un decimal', () => {
    // (30 + 3 + 12) / 4 = 11,25 -> 11,3
    expect(summarizePreparation(rows, new Map()).averageMinutes).toBe(11.3);
    expect(summarizePreparation(rows, new Map()).itemsMeasured).toBe(4);
  });

  it('desglose por categoria de mayor a menor tiempo; el producto sin categoria cuenta solo en el global', () => {
    const categories = new Map([
      [P(1), PIZZAS],
      [P(2), BEBIDAS],
    ]);
    expect(summarizePreparation(rows, categories).byCategory).toEqual([
      { categoryId: 'c-pizzas', categoryName: 'Pizzas', averageMinutes: 15, itemsMeasured: 2 },
      { categoryId: 'c-bebidas', categoryName: 'Bebidas', averageMinutes: 3, itemsMeasured: 1 },
    ]);
  });

  it('Catalog no respondio: byCategory null; sin items: promedio null y desglose vacio', () => {
    expect(summarizePreparation(rows, null).byCategory).toBeNull();
    expect(summarizePreparation([], new Map())).toEqual({
      averageMinutes: null,
      itemsMeasured: 0,
      byCategory: [],
    });
  });
});

describe('dashboard: ensamblado', () => {
  const base = {
    period: { from: '2026-11-09', to: '2026-11-15' },
    previousPeriod: { from: '2026-11-02', to: '2026-11-08' },
    byDay: [],
    byHour: [],
    waiters: [],
    methods: [],
    products: [],
    preparation: [],
    previousPreparation: [],
    categories: new Map(),
  };

  it('periodo sin ventas: ceros, series completas, listas vacias y sin NaN', () => {
    const d = buildDashboard({
      ...base,
      totals: { sales: 0, orders: 0 },
      previousTotals: { sales: 0, orders: 0 },
    });
    expect(d.kpis).toEqual({
      sales: { value: 0, previous: 0, changePercent: null },
      orders: { value: 0, previous: 0, changePercent: null },
      averageTicket: { value: 0, previous: 0, changePercent: null },
      preparationMinutes: { value: null, previous: null, changePercent: null },
    });
    expect(d.salesByDay).toHaveLength(7);
    expect(d.salesByHour).toHaveLength(24);
    expect(d.topProducts).toEqual([]);
    expect(d.preparation).toEqual({ averageMinutes: null, itemsMeasured: 0, byCategory: [] });
    expect(JSON.stringify(d)).not.toMatch(/NaN|Infinity|null,"previous":0/);
  });

  it('KPIs con el periodo anterior y desgloses ordenados como el cierre de caja', () => {
    const d = buildDashboard({
      ...base,
      totals: { sales: 300000, orders: 4 },
      previousTotals: { sales: 250000, orders: 5 },
      preparation: [{ productId: P(1), items: 2, seconds: 1440 }], // 12 min
      previousPreparation: [{ productId: P(1), items: 1, seconds: 900 }], // 15 min
      waiters: [
        { waiterId: 'b', totalAmount: 100000, ordersCount: 1 },
        { waiterId: 'a', totalAmount: 100000, ordersCount: 2 },
        { waiterId: 'c', totalAmount: 100000, ordersCount: 1 },
      ],
    });
    expect(d.kpis.sales).toEqual({ value: 300000, previous: 250000, changePercent: 20 });
    expect(d.kpis.orders).toEqual({ value: 4, previous: 5, changePercent: -20 });
    expect(d.kpis.averageTicket).toEqual({ value: 75000, previous: 50000, changePercent: 50 });
    expect(d.kpis.preparationMinutes).toEqual({ value: 12, previous: 15, changePercent: -20 });
    expect(d.waiterBreakdown.map((w) => w.waiterId)).toEqual(['a', 'b', 'c']);
  });

  it('sortBreakdown: mayor monto primero', () => {
    expect(
      sortBreakdown(
        [
          { paymentMethodId: 'x', totalAmount: 1 },
          { paymentMethodId: 'y', totalAmount: 5 },
        ],
        'paymentMethodId',
      ).map((m) => m.paymentMethodId),
    ).toEqual(['y', 'x']);
  });
});
