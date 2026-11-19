// GC-158. De la fila guardada en cash_closures (con sus desgloses) a las formas del contrato. Los desgloses vienen
// sin orden de la base: aqui se ordenan igual que en la vista previa (cashClose.js) para que un cierre confirmado
// se vea exactamente como se vio antes de confirmarlo.
const byAmountDesc = (key) => (a, b) =>
  b.totalAmount - a.totalAmount || (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0);

const dayOf = (closure) => closure.closureDate.toISOString().slice(0, 10);

// CashClosureSummary: una fila del historial
export function toClosureSummary(closure) {
  return {
    closureId: closure.closureId,
    date: dayOf(closure),
    totalSales: closure.totalSales,
    tablesServed: closure.tablesServed,
    averageTicket: closure.averageTicket,
    confirmedBy: closure.confirmedBy,
    confirmedAt: closure.confirmedAt,
  };
}

// CashClose completo: el consolidado guardado (snapshot, no el calculo en vivo) mas quien y cuando lo confirmo
export function toCashClose(closure) {
  return {
    date: dayOf(closure),
    totalSales: closure.totalSales,
    tablesServed: closure.tablesServed,
    averageTicket: closure.averageTicket,
    paymentBreakdown: closure.paymentBreakdown
      .map(({ paymentMethodId, totalAmount, paymentCount }) => ({
        paymentMethodId,
        totalAmount,
        paymentCount,
      }))
      .sort(byAmountDesc('paymentMethodId')),
    topProducts: closure.topProducts
      .map(({ rank, productId, productNameSnapshot, quantitySold }) => ({
        rank,
        productId,
        productName: productNameSnapshot,
        quantitySold,
      }))
      .sort((a, b) => a.rank - b.rank),
    waiterBreakdown: closure.waiterBreakdown
      .map(({ waiterId, totalAmount }) => ({ waiterId, totalAmount }))
      .sort(byAmountDesc('waiterId')),
    closureId: closure.closureId,
    confirmedBy: closure.confirmedBy,
    confirmedAt: closure.confirmedAt,
  };
}
