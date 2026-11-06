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
  create: (data) => prisma.shift.create({ data }),
};
