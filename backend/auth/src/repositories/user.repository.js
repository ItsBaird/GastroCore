import { prisma } from '../config/prisma.js';

export const userRepository = {
  create(data) {
    return prisma.user.create({ data });
  },

  // Con los codigos de permiso para armar el access token
  findByEmailWithPermissions(email) {
    return prisma.user.findUnique({
      where: { email },
      include: { permissions: { include: { permission: { select: { code: true } } } } },
    });
  },

  findByIdWithPermissions(userId) {
    return prisma.user.findUnique({
      where: { userId },
      include: { permissions: { include: { permission: { select: { code: true } } } } },
    });
  },

  // Incremento atomico: dos intentos simultaneos no se pisan el contador
  incrementFailedAttempts(userId) {
    return prisma.user.update({
      where: { userId },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });
  },

  lockUntil(userId, lockedUntil) {
    return prisma.user.update({ where: { userId }, data: { lockedUntil } });
  },

  resetLoginState(userId) {
    return prisma.user.update({
      where: { userId },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
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
