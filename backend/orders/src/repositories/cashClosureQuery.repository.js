import { prisma } from '../config/prisma.js';

// GC-158. Lectura de los cierres ya confirmados (solo lectura: confirmar vive en cashClosure.repository.js).

// Historial: del mas reciente al mas antiguo por el dia que se cerro (uq_closures_date: no hay empates)
export async function listClosures({ skip, take }) {
  const [rows, total] = await Promise.all([
    prisma.cashClosure.findMany({ orderBy: { closureDate: 'desc' }, skip, take }),
    prisma.cashClosure.count(),
  ]);
  return { rows, total };
}

// El cierre de un dia con sus tres desgloses, o null si ese dia no se ha cerrado
export async function findClosureByDate(date) {
  return prisma.cashClosure.findUnique({
    where: { closureDate: new Date(`${date}T00:00:00Z`) },
    include: { paymentBreakdown: true, topProducts: true, waiterBreakdown: true },
  });
}
