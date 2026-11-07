import { prisma } from '../config/prisma.js';

export const employeeRepository = {
  findAll: () => prisma.employee.findMany({ orderBy: [{ fullName: 'asc' }] }),
  findById: (userId) => prisma.employee.findUnique({ where: { userId } }),
  findNamesByIds: (userIds) =>
    prisma.employee.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, fullName: true },
    }),
  create: (data) => prisma.employee.create({ data }),
  update: (userId, data) => prisma.employee.update({ where: { userId }, data }),
};
