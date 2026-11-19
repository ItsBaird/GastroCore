import { AppError } from '../errors/AppError.js';
import { toCashClose, toClosureSummary } from '../mappers/cashClosure.mapper.js';
import { findClosureByDate, listClosures } from '../repositories/cashClosureQuery.repository.js';

// GC-158. Historial de cierres confirmados (GET /reports/cash-closures), del mas reciente al mas antiguo.
// Sin cierres no es un error: lista vacia y total 0.
export async function listCashClosures({ page, pageSize }) {
  const { rows, total } = await listClosures({ skip: (page - 1) * pageSize, take: pageSize });
  return { items: rows.map(toClosureSummary), page, pageSize, total };
}

// GET /reports/cash-closures/{date}: el cierre CONFIRMADO de ese dia (lo guardado, no el calculo en vivo). La
// pantalla lo usa para saber si el dia ya esta cerrado y mostrar el consolidado tal como se confirmo.
export async function getCashClosureByDate(date) {
  const closure = await findClosureByDate(date);
  if (!closure) {
    throw new AppError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Ese día todavía no tiene cierre de caja',
      details: { date },
    });
  }
  return toCashClose(closure);
}
