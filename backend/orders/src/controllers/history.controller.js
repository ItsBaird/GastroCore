import { getSalesHistory, getSalesHistoryOrder } from '../services/history.service.js';
import { exportSalesHistory } from '../services/historyExport.service.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// GC-190. Descarga del .xlsx: el navegador lo guarda con el nombre del rango. No se cachea (datos de caja).
export async function exportSalesHistoryController(req, res) {
  const { fileName, buffer } = await exportSalesHistory(req.valid.query);
  res.set({
    'Content-Type': XLSX,
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store',
  });
  res.send(buffer);
}

export async function salesHistoryController(req, res) {
  res.json(await getSalesHistory(req.valid.query));
}

export async function salesHistoryOrderController(req, res) {
  res.json(await getSalesHistoryOrder(req.valid.params.orderId));
}
