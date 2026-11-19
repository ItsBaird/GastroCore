import { Prisma } from '@prisma/client';
import { findOpenTables } from '../clients/orders.client.js';
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

const shiftNotFound = () =>
  new AppError({ status: 404, code: 'NOT_FOUND', message: 'Turno no encontrado' });

const forbidden = (message) => new AppError({ status: 403, code: 'FORBIDDEN', message });

const invalidTransition = (message, details = {}) =>
  new AppError({ status: 409, code: 'INVALID_TRANSITION', message, details });

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

// Consulta interna de Orders: { active: true, shift } si el empleado tiene un turno en estado 'activo'
// (lo inicio y aun no lo finaliza), o { active: false }.
export async function getActiveShift(userId) {
  const shift = await shiftRepository.findActiveByUserId(userId);
  return shift ? { active: true, shift: toShift(shift) } : { active: false };
}

async function findShift(shiftId) {
  const shift = await shiftRepository.findById(shiftId);
  if (!shift) throw shiftNotFound();
  return shift;
}

// GC-STAFF-0003. programado -> activo. Solo el propio empleado (un ADMIN tambien inicia unicamente su
// turno), y solo dentro del rango programado: desde la hora de inicio y antes de la de fin.
// `now` se inyecta para poder probar la hora sin esperar. Si no es la hora, el error trae el rango del
// turno para que la pantalla muestre cuando empieza.
export async function startShift(shiftId, user, now = new Date()) {
  const shift = await findShift(shiftId);
  if (shift.userId !== user.userId) throw forbidden('Solo puedes iniciar tu propio turno');
  if (shift.status !== 'programado') {
    throw invalidTransition(`El turno ya esta ${shift.status}`, { status: shift.status });
  }

  const range = { scheduledStart: shift.scheduledStart, scheduledEnd: shift.scheduledEnd };
  if (now < shift.scheduledStart) {
    throw invalidTransition('Todavia no es la hora de tu turno', {
      ...range,
      reason: 'BEFORE_START',
    });
  }
  if (now >= shift.scheduledEnd) {
    throw invalidTransition('Tu turno programado ya termino', { ...range, reason: 'AFTER_END' });
  }

  const started = await shiftRepository.transition(shiftId, 'programado', {
    status: 'activo',
    actualStart: now,
  });
  // Otra peticion lo cambio justo antes (la transicion es atomica)
  if (!started) throw invalidTransition('El turno ya no esta programado');
  return toShift(started);
}

// activo -> finalizado. El propio empleado o un ADMIN. Si el empleado tiene mesas abiertas
// (Staff consulta a Orders) responde 409 HAS_OPEN_TABLES: el ADMIN debe reasignarlas primero.
// Si Orders no responde, el 503 se propaga y el turno sigue activo.
export async function endShift(shiftId, user, now = new Date()) {
  const shift = await findShift(shiftId);
  if (shift.userId !== user.userId && user.role !== 'ADMIN') {
    throw forbidden('Solo puedes finalizar tu propio turno');
  }
  if (shift.status !== 'activo') {
    throw invalidTransition(`El turno no esta activo (estado: ${shift.status})`, {
      status: shift.status,
    });
  }

  const open = await findOpenTables(shift.userId);
  if (open.count > 0) {
    throw new AppError({
      status: 409,
      code: 'HAS_OPEN_TABLES',
      message:
        'El empleado tiene mesas abiertas: el administrador debe reasignarlas antes de finalizar el turno',
      details: { count: open.count },
    });
  }

  // La base exige actual_end > actual_start (CHECK): si el reloj no avanzo ni un milisegundo desde el
  // inicio (o retrocedio), el fin se registra un milisegundo despues en vez de fallar con un 500.
  const endedAt = now > shift.actualStart ? now : new Date(shift.actualStart.getTime() + 1);
  const ended = await shiftRepository.transition(shiftId, 'activo', {
    status: 'finalizado',
    actualEnd: endedAt,
  });
  if (!ended) throw invalidTransition('El turno ya no esta activo');
  return toShift(ended);
}
