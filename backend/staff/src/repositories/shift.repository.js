import { prisma } from '../config/prisma.js';

export const shiftRepository = {
  // Filtros opcionales: empleado y/o rango [from, to) por hora de inicio programada
  findMany: ({ userId, from, to } = {}) =>
    prisma.shift.findMany({
      where: {
        ...(userId && { userId }),
        ...(from && to && { scheduledStart: { gte: from, lt: to } }),
      },
      orderBy: [{ scheduledStart: 'asc' }, { userId: 'asc' }],
    }),
  findById: (shiftId) => prisma.shift.findUnique({ where: { shiftId } }),
  // Turno activo de un empleado (deberia ser uno solo; si hubiera mas, el de inicio programado mas reciente)
  findActiveByUserId: (userId) =>
    prisma.shift.findFirst({
      where: { userId, status: 'activo' },
      orderBy: { scheduledStart: 'desc' },
    }),
  create: (data) => prisma.shift.create({ data }),
  // Cambio de estado atomico: solo se aplica si el turno sigue en `from` (evita que dos peticiones
  // simultaneas lo inicien o finalicen dos veces). Devuelve el turno actualizado, o null si no cambio.
  async transition(shiftId, from, data) {
    const { count } = await prisma.shift.updateMany({ where: { shiftId, status: from }, data });
    return count === 0 ? null : prisma.shift.findUnique({ where: { shiftId } });
  },
};
