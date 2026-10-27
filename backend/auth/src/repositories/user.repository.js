import { prisma } from '../config/prisma.js';

export const userRepository = {
  create(data) {
    return prisma.user.create({ data });
  },

  findAll() {
    return prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
  },

  findById(userId) {
    return prisma.user.findUnique({ where: { userId } });
  },

  // El usuario y sus sesiones cambian en una sola transaccion
  update(userId, data, { revokeSessions = false } = {}) {
    const updateUser = prisma.user.update({ where: { userId }, data });
    if (!revokeSessions) return updateUser;
    return prisma
      .$transaction([
        updateUser,
        prisma.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      ])
      .then(([user]) => user);
  },
};
