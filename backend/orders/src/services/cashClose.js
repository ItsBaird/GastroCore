// Calculo del consolidado del cierre de caja (GC-RPT-0001) a partir de los datos ya leidos. Es una funcion pura:
// no toca la base ni el reloj, asi que cada regla se prueba con datos de ejemplo.
//
// Reglas (todas sobre ordenes CERRADA cuyo cierre cae en el dia de negocio; ver businessDay.js):
//   - totalSales: suma de payments.total, o sea lo cobrado DESPUES del descuento. Montos enteros (R5).
//   - tablesServed: cuentas cerradas del dia (una por pago: payments es 1:1 con orders). Una mesa que se
//     atiende dos veces en el dia cuenta dos veces, igual que en el ticket promedio.
//   - averageTicket: totalSales / tablesServed redondeado al entero mas cercano; 0 sin ordenes.
//   - paymentBreakdown: por metodo, lo cobrado y cuantos pagos. Se agrupa por payment_method_id (no cambia),
//     no por nombre; los metodos sin pagos no aparecen. En efectivo se suma el total de la cuenta, no lo
//     recibido (el cambio no es venta).
//   - topProducts: los 5 mas vendidos por unidades (items no cancelados). Desempate: mas ingreso bruto
//     (precio del snapshot R3 x cantidad), luego nombre. El nombre es el del snapshot mas reciente.
//   - waiterBreakdown: lo cobrado atribuido al mesero que ABRIO la mesa (orders.opened_by), no al que cobra.
export const TOP_PRODUCTS = 5;

const byAmountDesc = (key) => (a, b) =>
  b.totalAmount - a.totalAmount || (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0);

function groupTotals(payments, keyOf, keyName) {
  const groups = new Map();
  for (const payment of payments) {
    const key = keyOf(payment);
    const group = groups.get(key) ?? { [keyName]: key, totalAmount: 0, paymentCount: 0 };
    group.totalAmount += payment.total;
    group.paymentCount += 1;
    groups.set(key, group);
  }
  return [...groups.values()];
}

function rankProducts(items) {
  const products = new Map();
  for (const item of items) {
    const current = products.get(item.productId) ?? {
      productId: item.productId,
      productName: item.productNameSnapshot,
      latestAt: item.createdAt.getTime(),
      quantitySold: 0,
      revenue: 0,
    };
    current.quantitySold += item.quantity;
    current.revenue += item.quantity * item.unitPriceSnapshot;
    if (item.createdAt.getTime() > current.latestAt) {
      current.latestAt = item.createdAt.getTime();
      current.productName = item.productNameSnapshot;
    }
    products.set(item.productId, current);
  }
  return [...products.values()]
    .sort(
      (a, b) =>
        b.quantitySold - a.quantitySold ||
        b.revenue - a.revenue ||
        a.productName.localeCompare(b.productName, 'es') ||
        (a.productId < b.productId ? -1 : 1),
    )
    .slice(0, TOP_PRODUCTS)
    .map(({ productId, productName, quantitySold }, index) => ({
      rank: index + 1,
      productId,
      productName,
      quantitySold,
    }));
}

// `payments`: [{ total, paymentMethodId, order: { openedBy } }]. `items`: items no cancelados de esas ordenes
// [{ productId, productNameSnapshot, quantity, unitPriceSnapshot, createdAt }].
export function buildCashClosePreview({ date, payments, items }) {
  const totalSales = payments.reduce((sum, payment) => sum + payment.total, 0);
  const tablesServed = payments.length;

  const paymentBreakdown = groupTotals(payments, (p) => p.paymentMethodId, 'paymentMethodId')
    .sort(byAmountDesc('paymentMethodId'))
    .map(({ paymentMethodId, totalAmount, paymentCount }) => ({
      paymentMethodId,
      totalAmount,
      paymentCount,
    }));

  const waiterBreakdown = groupTotals(payments, (p) => p.order.openedBy, 'waiterId')
    .sort(byAmountDesc('waiterId'))
    .map(({ waiterId, totalAmount }) => ({ waiterId, totalAmount }));

  return {
    date,
    totalSales,
    tablesServed,
    averageTicket: tablesServed === 0 ? 0 : Math.round(totalSales / tablesServed),
    paymentBreakdown,
    topProducts: rankProducts(items),
    waiterBreakdown,
  };
}
