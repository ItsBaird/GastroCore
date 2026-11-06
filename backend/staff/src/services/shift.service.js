import { Prisma } from '@prisma/client';
import { AppError } from '../errors/AppError.js';
import { employeeRepository } from '../repositories/employee.repository.js';
import { shiftRepository } from '../repositories/shift.repository.js';
import { weekRange } from '../utils/week.js';

export function toShift(s) {
  return {
    shiftId: s.shiftId,
    userId: s.userId,
    scheduledStart: s.scheduledStart,
    scheduledEnd: s.scheduledEnd,
    actualStart: s.actualStart,
    actualEnd: s.actualEnd,
    status: s.status,
  };
}

const employeeNotFound = () =>
  new AppError({ status: 404, code: 'NOT_FOUND', message: 'Empleado no encontrado' });

// Sin filtros devuelve todos los turnos. Con `week` (cualquier dia de la semana) devuelve los que
// empiezan entre el lunes 00:00 y el domingo 24:00, hora de Colombia. Con `userId`, solo los de ese empleado.
export async function listShifts({ week, userId } = {}) {
  const range = week ? weekRange(week) : {};
  const shifts = await shiftRepository.findMany({ userId, from: range.start, to: range.end });
  return shifts.map(toShift);
}

// GC-STAFF-0002. El rango (fin > inicio) ya lo valido el esquema; la base lo vuelve a exigir con un CHECK.
// El estado no viene del cliente: la base lo deja en 'programado' y sin horas reales.
export async function createShift({ userId, scheduledStart, scheduledEnd }) {
  if (!(await employeeRepository.findById(userId))) throw employeeNotFound();
  try {
    return toShift(await shiftRepository.create({ userId, scheduledStart, scheduledEnd }));
  } catch (err) {
    // El empleado se borro entre la comprobacion y el insert (FK de shifts.user_id)
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      throw employeeNotFound();
    }
    throw err;
  }
}
