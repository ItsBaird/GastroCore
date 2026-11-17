// GC-RPT-0003 (GC-188). Calculos puros del historial de ventas: no tocan la base ni el reloj.

// Referencia visible de una cuenta: los 6 primeros caracteres del UUID en mayusculas (decision "opcion C": no hay
// numero de orden en la base). No se garantiza unica; el identificador real sigue siendo orderId.
export function referenceOf(orderId) {
  return orderId.slice(0, 6).toUpperCase();
}

// Una fila del historial (HistoryOrder) desde la orden leida. Los montos salen del PAGO, que es el snapshot de lo
// que se cobro (R3): subtotal, descuento y total no se recalculan. itemsCount son las UNIDADES no canceladas (el
// repositorio ya trae solo esas).
export function toHistoryOrder(order) {
  const itemsCount = order.rounds.reduce(
    (sum, round) => sum + round.items.reduce((acc, item) => acc + item.quantity, 0),
    0,
  );
  return {
    orderId: order.orderId,
    reference: referenceOf(order.orderId),
    tableId: order.tableId,
    tableNumber: order.table.tableNumber,
    waiterId: order.openedBy,
    openedAt: order.openedAt,
    closedAt: order.closedAt,
    itemsCount,
    subtotal: order.payment.subtotal,
    discountAmount: order.payment.discountAmount,
    total: order.payment.total,
    paymentMethodId: order.payment.paymentMethodId,
  };
}

// Resumen de TODO el filtro (no de la pagina). Misma regla que el cierre de caja: ventas = suma de payments.total
// (lo cobrado despues del descuento) y ticket promedio redondeado al entero mas cercano; 0 sin cuentas.
export function buildHistorySummary({ totalSales, ordersCount }) {
  return {
    totalSales,
    ordersCount,
    averageTicket: ordersCount === 0 ? 0 : Math.round(totalSales / ordersCount),
  };
}
