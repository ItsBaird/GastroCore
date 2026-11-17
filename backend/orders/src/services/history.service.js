import { AppError } from '../errors/AppError.js';
import {
  aggregateHistory,
  findHistoryOrder,
  findHistoryPage,
} from '../repositories/history.repository.js';
import { businessDateOf, businessRange } from './businessDay.js';
import { buildHistorySummary, toHistoryOrder, toHistoryOrderDetail } from './history.js';

// GC-189. GET /api/orders/history/{orderId}: el detalle de una venta. Si la orden no existe o todavia no esta
// CERRADA (abierta o en cobro) no es una venta del historial: 404 ORDER_NOT_FOUND (codigo del contrato).
export async function getSalesHistoryOrder(orderId) {
  const order = await findHistoryOrder(orderId);
  if (!order) {
    throw new AppError({
      status: 404,
      code: 'ORDER_NOT_FOUND',
      message: 'La venta no existe o la cuenta todavía no está cerrada',
    });
  }
  return toHistoryOrderDetail(order);
}

// GC-RPT-0003 (GC-188). GET /api/orders/history: ventas cerradas de los dias de negocio `from`..`to` (ambos
// incluidos), con filtros y paginacion; `summary` es de TODO el filtro. Sin fechas, el dia de negocio actual.
// La validacion (fechas reales, from <= to, maximo 366 dias, UUIDs, paginacion) ya la hizo history.schema.js.
// `now` se inyecta para probar el limite de la medianoche.
export async function getSalesHistory(query, now = new Date()) {
  const today = businessDateOf(now);
  const from = query.from ?? today;
  const to = query.to ?? today;
  const { page, pageSize } = query;
  const filters = {
    ...businessRange(from, to),
    waiterId: query.waiterId,
    tableId: query.tableId,
    paymentMethodId: query.paymentMethodId,
  };

  const [orders, totals] = await Promise.all([
    findHistoryPage({ ...filters, skip: (page - 1) * pageSize, take: pageSize }),
    aggregateHistory(filters),
  ]);

  return {
    items: orders.map(toHistoryOrder),
    page,
    pageSize,
    total: totals.ordersCount,
    summary: buildHistorySummary(totals),
  };
}
