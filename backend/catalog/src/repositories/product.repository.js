import { prisma } from '../config/prisma.js';

export const productRepository = {
  create: (data) => prisma.product.create({ data }),
};
