import { TOP_PRODUCTS } from './cashClose.js';
import { listDays } from './dashboardPeriod.js';

// GC-RPT-0004. Ensamblado del dashboard a partir de agregados ya calculados en SQL. Funciones puras: sin base,
// sin reloj y sin red, para probar cada regla con datos de ejemplo. Montos enteros COP (R5).

// Un decimal, simetrico para negativos: -4,05 % es -4,1 % (Math.round daria -4,0)
export function round1(value) {
  const rounded = (Math.sign(value) * Math.round(Math.abs(value) * 10)) / 10;
  return rounded === 0 ? 0 : rounded; // sin -0
}

// (valor - anterior) / anterior x 100. Sin anterior (0 o null) no hay porcentaje: null, nunca 0 % ni infinito
export function changePercent(value, previous) {
  if (value === null || previous === null || previous === 0) return null;
  return round1(((value - previous) / previous) * 100);
}

export const kpi = (value, previous) => ({
  value,
  previous,
  changePercent: changePercent(value, previous),
});

// Igual que el cierre de caja: ventas / cuentas al entero mas cercano; 0 sin cuentas
export const averageTicket = ({ sales, orders }) => (orders === 0 ? 0 : Math.round(sales / orders));

// Un elemento por cada dia del periodo, con cero donde no hubo ventas
export function fillDays(period, rows) {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  return listDays(period).map((date) => ({
    date,
    totalSales: byDate.get(date)?.totalSales ?? 0,
    orders: byDate.get(date)?.orders ?? 0,
  }));
}

// Siempre las 24 horas (0-23) del dia de negocio
export function fillHours(rows) {
  const byHour = new Map(rows.map((r) => [r.hour, r]));
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    totalSales: byHour.get(hour)?.totalSales ?? 0,
    orders: byHour.get(hour)?.orders ?? 0,
  }));
}

// Mismo orden que el cierre de caja (cashClose.js, rankProducts): mas unidades, mas ingreso bruto, nombre y por
// ultimo el id. Esa funcion no esta exportada; dashboard.test.js compara este orden con buildCashClosePreview
// sobre los mismos datos y falla si alguna vez divergen.
export function rankTopProducts(rows) {
  return [...rows]
    .sort(
      (a, b) =>
        b.quantitySold - a.quantitySold ||
        b.revenue - a.revenue ||
        a.productName.localeCompare(b.productName, 'es') ||
        (a.productId < b.productId ? -1 : 1),
    )
    .slice(0, TOP_PRODUCTS)
    .map(({ productId, productName, quantitySold, revenue }, index) => ({
      rank: index + 1,
      productId,
      productName,
      quantitySold,
      revenue,
    }));
}

// Mayor monto primero; a igual monto, por id (como byAmountDesc del cierre de caja)
const byAmountDesc = (key) => (a, b) =>
  b.totalAmount - a.totalAmount || (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0);

export const sortBreakdown = (rows, key) => [...rows].sort(byAmountDesc(key));

const minutes = (seconds, items) => (items === 0 ? null : round1(seconds / items / 60));

// `rows`: por producto, { productId, items, seconds } de los items medidos. `categories`: Map productId ->
// { categoryId, categoryName }, o null si Catalog no respondio. Un producto que Catalog ya no tiene cuenta en
// el promedio global y no en el desglose.
export function summarizePreparation(rows, categories) {
  const items = rows.reduce((sum, r) => sum + r.items, 0);
  const seconds = rows.reduce((sum, r) => sum + r.seconds, 0);

  let byCategory = null;
  if (categories) {
    const groups = new Map();
    for (const row of rows) {
      const category = categories.get(row.productId);
      if (!category || row.items === 0) continue;
      const group = groups.get(category.categoryId) ?? { ...category, items: 0, seconds: 0 };
      group.items += row.items;
      group.seconds += row.seconds;
      groups.set(category.categoryId, group);
    }
    byCategory = [...groups.values()]
      .map((g) => ({
        categoryId: g.categoryId,
        categoryName: g.categoryName,
        averageMinutes: minutes(g.seconds, g.items),
        itemsMeasured: g.items,
      }))
      .sort(
        (a, b) =>
          b.averageMinutes - a.averageMinutes || a.categoryName.localeCompare(b.categoryName, 'es'),
      );
  }

  return { averageMinutes: minutes(seconds, items), itemsMeasured: items, byCategory };
}

export function buildDashboard({
  period,
  previousPeriod,
  totals,
  previousTotals,
  byDay,
  byHour,
  waiters,
  methods,
  products,
  preparation,
  previousPreparation,
  categories,
}) {
  const current = summarizePreparation(preparation, categories);
  const previous = summarizePreparation(previousPreparation, null);
  return {
    period,
    previousPeriod,
    kpis: {
      sales: kpi(totals.sales, previousTotals.sales),
      orders: kpi(totals.orders, previousTotals.orders),
      averageTicket: kpi(averageTicket(totals), averageTicket(previousTotals)),
      preparationMinutes: kpi(current.averageMinutes, previous.averageMinutes),
    },
    salesByDay: fillDays(period, byDay),
    salesByHour: fillHours(byHour),
    topProducts: rankTopProducts(products),
    preparation: current,
    waiterBreakdown: sortBreakdown(waiters, 'waiterId'),
    paymentBreakdown: sortBreakdown(methods, 'paymentMethodId'),
  };
}
