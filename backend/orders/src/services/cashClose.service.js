import { AppError } from '../errors/AppError.js';
import { confirmClosure } from '../repositories/cashClosure.repository.js';
import { findPaymentsOfDay, findSoldItemsOfDay } from '../repositories/reports.repository.js';
import { businessDateOf, businessDayRange } from './businessDay.js';
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

// GC-RPT-0002 (GC-154, GC-155). Confirma el cierre de caja de `date`: guarda el consolidado con sus desgloses y
// deja el dia bloqueado (los cobros de ese dia se rechazan con DAY_CLOSED, ver payment.service). El consolidado
// se calcula en el servidor dentro de la transaccion con las mismas reglas de la vista previa; el cliente solo
// dice QUE dia cerrar (R4). Un dia futuro no se puede cerrar: aun no tiene ventas y bloquearia el dia que empieza.
// `now` se inyecta para probar el limite de la medianoche.
export async function confirmCashClose(date, user, now = new Date()) {
  if (date > businessDateOf(now)) {
    throw new AppError({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'No se puede cerrar un día que aún no empieza',
      details: { field: 'date', today: businessDateOf(now) },
    });
  }

  const result = await confirmClosure({
    date,
    range: businessDayRange(date),
    userId: user.userId,
    build: ({ payments, items }) => buildCashClosePreview({ date, payments, items }),
  });
  if (result.alreadyClosed) {
    throw new AppError({
      status: 409,
      code: 'DAY_CLOSED',
      message: 'El cierre de caja de ese día ya fue confirmado',
      details: { date },
    });
  }

  const { closure, preview } = result;
  return {
    ...preview,
    closureId: closure.closureId,
    confirmedBy: closure.confirmedBy,
    confirmedAt: closure.confirmedAt,
  };
}
