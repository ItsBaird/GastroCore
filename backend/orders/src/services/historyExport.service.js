import writeXlsxFile from 'write-excel-file/node';
import { staffClient } from '../clients/staffClient.js';
import { AppError } from '../errors/AppError.js';
import { aggregateHistory, findHistoryForExport } from '../repositories/history.repository.js';
import { buildHistorySummary, toHistoryOrder } from './history.js';
import { resolveHistoryFilters } from './history.service.js';
import {
  buildSalesSheet,
  COLUMNS,
  exportFileName,
  MAX_EXPORT_ROWS,
  SHEET_NAME,
} from './historyExport.js';

// Staff responde hasta 100 ids por consulta (/internal/employees)
const NAMES_BATCH = 100;

// Nombres de los meseros desde Staff. Son informativos: si Staff falla, el archivo se genera igual y esos meseros
// salen como "Sin perfil de empleado" (getEmployeeNames ya devuelve un Map vacio ante cualquier error).
async function waiterNamesOf(rows) {
  const ids = [...new Set(rows.map((row) => row.waiterId))];
  const names = new Map();
  for (let i = 0; i < ids.length; i += NAMES_BATCH) {
    const batch = await staffClient.getEmployeeNames(ids.slice(i, i + NAMES_BATCH));
    for (const [id, name] of batch) names.set(id, name);
  }
  return names;
}

// GC-RPT-0003 (GC-190). GET /api/orders/history/export: las ventas del filtro (los mismos del listado, sin
// paginar) en un .xlsx con la hoja "Ventas" y una fila final de totales. Primero se CUENTA: con mas de 10000 filas
// responde 422 EXPORT_TOO_LARGE sin leerlas (acotar el rango). Los nombres: la mesa y el metodo salen de esta base;
// los meseros, de Staff. Devuelve { fileName, buffer }.
export async function exportSalesHistory(query, now = new Date()) {
  const { from, to, filters } = resolveHistoryFilters(query, now);

  const totals = await aggregateHistory(filters);
  if (totals.ordersCount > MAX_EXPORT_ROWS) {
    throw new AppError({
      status: 422,
      code: 'EXPORT_TOO_LARGE',
      message: `Hay ${totals.ordersCount} ventas y el máximo para exportar es ${MAX_EXPORT_ROWS}. Acota el rango de fechas o los filtros.`,
      details: { rows: totals.ordersCount, max: MAX_EXPORT_ROWS },
    });
  }

  const orders = await findHistoryForExport(filters);
  const rows = orders.map((order) => ({
    ...toHistoryOrder(order),
    paymentMethodName: order.payment.paymentMethod.name,
  }));
  const sheet = buildSalesSheet({
    rows,
    waiterNames: await waiterNamesOf(rows),
    summary: buildHistorySummary(totals),
  });

  const buffer = await writeXlsxFile(sheet, {
    sheet: SHEET_NAME,
    columns: COLUMNS,
    stickyRowsCount: 1,
  }).toBuffer();

  return { fileName: exportFileName(from, to), buffer };
}
