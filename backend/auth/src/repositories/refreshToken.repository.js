import { prisma } from '../config/prisma.js';

export const refreshTokenRepository = {
  findByHash(tokenHash) {
    return prisma.refreshToken.findUnique({ where: { tokenHash } });
  },

  // Rotacion atomica: invalida el token usado, crea el nuevo y los encadena (replaced_by).
  // Devuelve null si otro request ya uso ese token (el UPDATE condicional no encuentra fila).
  rotate(refreshTokenId, { userId, tokenHash, expiresAt }) {
    return prisma.$transaction(async (tx) => {
      const { count } = await tx.refreshToken.updateMany({
        where: { refreshTokenId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (count === 0) return null;
      const created = await tx.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
      await tx.refreshToken.update({
        where: { refreshTokenId },
        data: { replacedBy: created.refreshTokenId },
      });
      return created;
    });
  },

  revokeByHash(tokenHash) {
    return prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  revokeAllForUser(userId) {
    return prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },
  create({ userId, tokenHash, expiresAt }) {
    return prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
  },
};
