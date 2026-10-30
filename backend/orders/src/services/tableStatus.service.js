import { findAllTablesWithOpenOrdersAndPendingCalls } from '../repositories/tableStatus.repository.js';

function deriveStatus(orders) {
  if (orders.length === 0) return 'libre';
  const order = orders[0];
  if (order.status === 'EN_COBRO') return 'en_cobro';
  return 'ocupada';
}

function toTableStatus(table) {
  const status = deriveStatus(table.orders);
  const order = table.orders[0] ?? null;

  const result = {
    tableId: table.tableId,
    tableNumber: table.tableNumber,
    status,
    pendingCalls: table.serviceCalls.map((sc) => ({
      serviceCallId: sc.serviceCallId,
      tableId: sc.tableId,
      type: sc.type,
      status: sc.status,
      createdAt: sc.createdAt,
    })),
  };

  if (order) {
    result.orderId = order.orderId;
    result.waiterId = order.waiterId;
  }

  return result;
}

export async function listTableStatuses() {
  const tables = await findAllTablesWithOpenOrdersAndPendingCalls();
  return tables.map(toTableStatus);
}
