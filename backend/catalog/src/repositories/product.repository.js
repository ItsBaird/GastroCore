import { prisma } from '../config/prisma.js';

export const productRepository = {
  findAll: () => prisma.product.findMany({ orderBy: [{ name: 'asc' }] }),
  findById: (productId) => prisma.product.findUnique({ where: { productId } }),
  create: (data) => prisma.product.create({ data }),
  update: (productId, data) => prisma.product.update({ where: { productId }, data }),
};
