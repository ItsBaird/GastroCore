import { prisma } from '../config/prisma.js';

// Las categorias sin orden explicito van al final, y entre iguales se ordena por nombre
const ORDER = [{ displayOrder: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }];

export const categoryRepository = {
  findAll: () => prisma.category.findMany({ orderBy: ORDER }),
  findById: (categoryId) => prisma.category.findUnique({ where: { categoryId } }),
  create: (data) => prisma.category.create({ data }),
  update: (categoryId, data) => prisma.category.update({ where: { categoryId }, data }),
  // Menu publico: solo categorias con al menos un producto disponible, y solo esos productos
  findMenu: () =>
    prisma.category.findMany({
      where: { products: { some: { isAvailable: true } } },
      include: { products: { where: { isAvailable: true }, orderBy: { name: 'asc' } } },
      orderBy: ORDER,
    }),
};
