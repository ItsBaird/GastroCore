import { findPaymentsOfDay, findSoldItemsOfDay } from '../repositories/reports.repository.js';
import { businessDayRange } from './businessDay.js';
import { buildCashClosePreview } from './cashClose.js';

// GC-RPT-0001 (GC-149, GC-150). Vista previa del cierre de caja de un dia, solo lectura. Un dia sin ordenes
// cerradas no es un error: responde todos los totales en 0 y listas vacias (contrato), y la pantalla indica
// que no hay nada para cerrar. Sirve tambien para un dia ya cerrado o futuro.
export async function getCashClosePreview(date) {
  const range = businessDayRange(date);
  const [payments, items] = await Promise.all([
    findPaymentsOfDay(range),
    findSoldItemsOfDay(range),
  ]);
  return buildCashClosePreview({ date, payments, items });
}
