import { prisma } from '../config/prisma.js';

export async function createPaymentMethod(data) {
  return prisma.paymentMethod.create({ data });
}

export async function findPaymentMethodById(id) {
  return prisma.paymentMethod.findUnique({ where: { paymentMethodId: id } });
}

// Sin distinguir mayusculas: "Efectivo" y "efectivo" son el mismo metodo para el negocio
export async function findPaymentMethodByName(name) {
  return prisma.paymentMethod.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
}

export async function updatePaymentMethod(id, data) {
  return prisma.paymentMethod.update({ where: { paymentMethodId: id }, data });
}

// `active` undefined = todos; true/false = solo activos / solo inactivos
export async function findAllPaymentMethods({ active } = {}) {
  return prisma.paymentMethod.findMany({
    where: active === undefined ? {} : { isActive: active },
    orderBy: { name: 'asc' },
  });
}

// Pagos registrados con este metodo. payments guarda solo payment_method_id (no el nombre ni si era efectivo),
// asi que mientras haya pagos el nombre y el tipo del metodo son parte del historial y del cierre de caja.
export async function countPaymentsByMethod(paymentMethodId) {
  return prisma.payment.count({ where: { paymentMethodId } });
}
