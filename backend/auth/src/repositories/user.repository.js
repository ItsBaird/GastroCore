import { prisma } from '../config/prisma.js';

export const userRepository = {
  create(data) {
    return prisma.user.create({ data });
  },
};
