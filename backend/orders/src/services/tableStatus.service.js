import { staffClient } from '../clients/staffClient.js';
import {
  findAllTablesWithOpenOrdersAndPendingCalls,
  findTableWithOpenOrderAndPendingCalls,
} from '../repositories/tableStatus.repository.js';

function deriveStatus(orders) {
  if (orders.length === 0) return 'libre';
  const order = orders[0];
  if (order.status === 'EN_COBRO') return 'en_cobro';
  return 'ocupada';
}

// itemsCount cuenta lineas de item no canceladas (no suma cantidades): es lo que distingue
// una mesa abierta sin pedido ("Tomar Pedido") de una con pedido ("Ver Detalle").
function countActiveItems(order) {
  return order.rounds.reduce((total, round) => total + round.items.length, 0);
}

function toTableStatus(table, names) {
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
    result.waiterName = names.get(order.waiterId) ?? null;
    result.itemsCount = countActiveItems(order);
  }

  return result;
}

function waiterIdsOf(tables) {
  return [...new Set(tables.flatMap((t) => t.orders.map((o) => o.waiterId)))];
}

export async function listTableStatuses() {
  const tables = await findAllTablesWithOpenOrdersAndPendingCalls();
  const names = await staffClient.getEmployeeNames(waiterIdsOf(tables));
  return tables.map((table) => toTableStatus(table, names));
}

export async function getTableStatus(tableId) {
  const table = await findTableWithOpenOrderAndPendingCalls(tableId);
  if (!table) return null;
  const names = await staffClient.getEmployeeNames(waiterIdsOf([table]));
  return toTableStatus(table, names);
}
