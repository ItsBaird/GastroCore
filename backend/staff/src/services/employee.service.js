import { Prisma } from '@prisma/client';
import { findAuthUser } from '../clients/auth.client.js';
import { AppError } from '../errors/AppError.js';
import { employeeRepository } from '../repositories/employee.repository.js';

// hire_date es DATE: se expone como AAAA-MM-DD (sin hora ni zona horaria)
export function toEmployee(e) {
  return {
    userId: e.userId,
    fullName: e.fullName,
    phone: e.phone,
    documentNumber: e.documentNumber,
    position: e.position,
    hireDate: e.hireDate.toISOString().slice(0, 10),
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

// La fecha llega como texto de calendario; se guarda como medianoche UTC para que el DATE no se corra de dia
const toDate = (value) => new Date(`${value}T00:00:00Z`);

const validationError = (path, message) =>
  new AppError({
    status: 400,
    code: 'VALIDATION_ERROR',
    message: 'Datos de entrada invalidos',
    details: { fields: [{ path, message }] },
  });

const notFound = () =>
  new AppError({ status: 404, code: 'NOT_FOUND', message: 'Empleado no encontrado' });

const isPrismaError = (err, code) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;

// Traduce la violacion de unicidad al contrato: usuario que ya tiene perfil o documento repetido
function mapWriteError(err) {
  if (isPrismaError(err, 'P2002')) {
    const target = [err.meta?.target ?? []].flat().join(',');
    if (target.includes('user_id') || target.includes('pkey')) {
      return new AppError({
        status: 409,
        code: 'CONFLICT',
        message: 'Ese usuario ya tiene un perfil de empleado',
        details: { field: 'userId' },
      });
    }
    return new AppError({
      status: 409,
      code: 'CONFLICT',
      message: 'El numero de documento ya existe',
      details: { field: 'documentNumber' },
    });
  }
  if (isPrismaError(err, 'P2025')) return notFound();
  return err;
}

export async function listEmployees() {
  return (await employeeRepository.findAll()).map(toEmployee);
}

export async function getEmployee(userId) {
  const employee = await employeeRepository.findById(userId);
  if (!employee) throw notFound();
  return toEmployee(employee);
}

// GC-STAFF-0001. `authorization` es la cabecera del ADMIN, que se reenvia a Auth para comprobar el userId
export async function createEmployee(input, authorization) {
  if (!(await findAuthUser(input.userId, authorization))) {
    throw validationError('userId', 'El usuario no existe en Auth');
  }
  try {
    return toEmployee(
      await employeeRepository.create({ ...input, hireDate: toDate(input.hireDate) }),
    );
  } catch (err) {
    throw mapWriteError(err);
  }
}

export async function updateEmployee(userId, input) {
  if (Object.keys(input).length === 0) {
    throw validationError('body', 'Envia al menos un campo para modificar');
  }
  try {
    return toEmployee(
      await employeeRepository.update(userId, {
        ...input,
        ...(input.hireDate && { hireDate: toDate(input.hireDate) }),
      }),
    );
  } catch (err) {
    throw mapWriteError(err);
  }
}
