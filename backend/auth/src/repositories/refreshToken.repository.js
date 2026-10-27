import { prisma } from '../config/prisma.js';

export const refreshTokenRepository = {
  create({ userId, tokenHash, expiresAt }) {
    return prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
  },
};
