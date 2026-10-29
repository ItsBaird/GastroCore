import { prisma } from '../config/prisma.js';

export async function createTable(data) {
  return prisma.diningTable.create({ data });
}

export async function findTableById(id) {
  return prisma.diningTable.findUnique({ where: { tableId: id } });
}

export async function updateTable(id, data) {
  return prisma.diningTable.update({ where: { tableId: id }, data });
}

export async function findAllTablesOrderedByNumber() {
  return prisma.diningTable.findMany({ orderBy: { tableNumber: 'asc' } });
}
