import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findAuthUser } from '../clients/auth.client.js';
import { AppError } from '../errors/AppError.js';
import { employeeRepository } from '../repositories/employee.repository.js';
import { MISSING_ID, USER_ID, makeAuthUser, makeEmployee } from '../test/helpers.js';
import {
  createEmployee,
  getEmployee,
  listEmployees,
  toEmployee,
  updateEmployee,
} from './employee.service.js';

vi.mock('../repositories/employee.repository.js', () => ({
  employeeRepository: { findAll: vi.fn(), findById: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
vi.mock('../clients/auth.client.js', () => ({ findAuthUser: vi.fn() }));

const prismaError = (code, target) =>
  new Prisma.PrismaClientKnownRequestError('x', {
    code,
    clientVersion: 'test',
    ...(target !== undefined && { meta: { target } }),
  });

async function expectAppError(promise, status, code) {
  const err = await promise.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect({ status: err.status, code: err.code }).toEqual({ status, code });
  return err;
}

const INPUT = {
  userId: USER_ID,
  fullName: 'Carlos Rodriguez',
  phone: '3001234567',
  documentNumber: '1012345678',
  position: 'Mesero',
  hireDate: '2026-03-15',
};
const BEARER = 'Bearer token-del-admin';

beforeEach(() => {
  vi.resetAllMocks();
  findAuthUser.mockResolvedValue(makeAuthUser());
});

describe('toEmployee', () => {
  it('expone los campos del contrato y la fecha de ingreso como AAAA-MM-DD', () => {
    expect(toEmployee(makeEmployee())).toEqual({
      userId: USER_ID,
      fullName: 'Carlos Rodriguez',
      phone: '3001234567',
      documentNumber: '1012345678',
      position: 'Mesero',
      hireDate: '2026-03-15',
      createdAt: new Date('2026-10-01T10:00:00Z'),
      updatedAt: new Date('2026-10-01T10:00:00Z'),
    });
  });

  it('un telefono null se conserva como null', () => {
    expect(toEmployee(makeEmployee({ phone: null })).phone).toBeNull();
  });

  it('no filtra campos internos de la fila', () => {
    expect(Object.keys(toEmployee({ ...makeEmployee(), shifts: [], extra: 1 })).sort()).toEqual([
      'createdAt',
      'documentNumber',
      'fullName',
      'hireDate',
      'phone',
      'position',
      'updatedAt',
      'userId',
    ]);
  });
});

describe('listEmployees / getEmployee', () => {
  it('lista los empleados en formato publico', async () => {
    employeeRepository.findAll.mockResolvedValue([
      makeEmployee(),
      makeEmployee({ userId: MISSING_ID }),
    ]);
    const out = await listEmployees();
    expect(out.map((e) => e.userId)).toEqual([USER_ID, MISSING_ID]);
    expect(out[0].hireDate).toBe('2026-03-15');
  });

  it('sin empleados devuelve []', async () => {
    employeeRepository.findAll.mockResolvedValue([]);
    expect(await listEmployees()).toEqual([]);
  });

  it('getEmployee devuelve el empleado', async () => {
    employeeRepository.findById.mockResolvedValue(makeEmployee());
    expect((await getEmployee(USER_ID)).fullName).toBe('Carlos Rodriguez');
    expect(employeeRepository.findById).toHaveBeenCalledWith(USER_ID);
  });

  it('getEmployee de un id inexistente -> 404 NOT_FOUND', async () => {
    employeeRepository.findById.mockResolvedValue(null);
    await expectAppError(getEmployee(MISSING_ID), 404, 'NOT_FOUND');
  });
});

describe('createEmployee', () => {
  it('consulta a Auth con el userId y la cabecera del ADMIN, y crea el perfil', async () => {
    employeeRepository.create.mockImplementation(async (data) => makeEmployee(data));
    const out = await createEmployee(INPUT, BEARER);
    expect(findAuthUser).toHaveBeenCalledWith(USER_ID, BEARER);
    expect(out).toMatchObject({ userId: USER_ID, hireDate: '2026-03-15' });
  });

  it('guarda la fecha de ingreso como medianoche UTC (el DATE no se corre de dia)', async () => {
    employeeRepository.create.mockImplementation(async (data) => makeEmployee(data));
    await createEmployee({ ...INPUT, hireDate: '2026-12-31' }, BEARER);
    expect(employeeRepository.create.mock.calls[0][0].hireDate).toEqual(
      new Date('2026-12-31T00:00:00Z'),
    );
  });

  it('el telefono es opcional: si no llega no se envia al repositorio', async () => {
    employeeRepository.create.mockImplementation(async (data) => makeEmployee(data));
    const noPhone = { ...INPUT };
    delete noPhone.phone;
    await createEmployee(noPhone, BEARER);
    expect(employeeRepository.create.mock.calls[0][0]).not.toHaveProperty('phone');
  });

  it('userId que no existe en Auth -> 400 sobre userId y no toca la base', async () => {
    findAuthUser.mockResolvedValue(null);
    const err = await expectAppError(createEmployee(INPUT, BEARER), 400, 'VALIDATION_ERROR');
    expect(err.details.fields).toEqual([
      { path: 'userId', message: 'El usuario no existe en Auth' },
    ]);
    expect(employeeRepository.create).not.toHaveBeenCalled();
  });

  it('si Auth no esta disponible el error 503 se propaga y no toca la base', async () => {
    const unavailable = new AppError({ status: 503, code: 'DEPENDENCY_UNAVAILABLE', message: 'x' });
    findAuthUser.mockRejectedValue(unavailable);
    await expect(createEmployee(INPUT, BEARER)).rejects.toBe(unavailable);
    expect(employeeRepository.create).not.toHaveBeenCalled();
  });

  describe('violaciones de unicidad (P2002)', () => {
    it.each([
      ['columna como arreglo', ['document_number']],
      ['nombre de la restriccion', 'uq_employees_document'],
      ['sin meta', undefined],
    ])('documento repetido (%s) -> 409 "el documento ya existe"', async (_name, target) => {
      employeeRepository.create.mockRejectedValue(prismaError('P2002', target));
      const err = await expectAppError(createEmployee(INPUT, BEARER), 409, 'CONFLICT');
      expect(err.message).toMatch(/documento ya existe/);
      expect(err.details).toEqual({ field: 'documentNumber' });
    });

    it.each([
      ['columna como arreglo', ['user_id']],
      ['nombre de la llave primaria', 'employees_pkey'],
    ])('el usuario ya tiene perfil (%s) -> 409 sobre userId', async (_name, target) => {
      employeeRepository.create.mockRejectedValue(prismaError('P2002', target));
      const err = await expectAppError(createEmployee(INPUT, BEARER), 409, 'CONFLICT');
      expect(err.message).toMatch(/ya tiene un perfil/);
      expect(err.details).toEqual({ field: 'userId' });
    });
  });

  it('un error desconocido de la base se propaga sin traducir', async () => {
    const boom = new Error('db caida');
    employeeRepository.create.mockRejectedValue(boom);
    await expect(createEmployee(INPUT, BEARER)).rejects.toBe(boom);
  });
});

describe('updateEmployee', () => {
  it('sin campos -> 400 y no toca la base', async () => {
    const err = await expectAppError(updateEmployee(USER_ID, {}), 400, 'VALIDATION_ERROR');
    expect(err.details.fields[0].path).toBe('body');
    expect(employeeRepository.update).not.toHaveBeenCalled();
  });

  it('actualiza solo los campos enviados y no consulta a Auth', async () => {
    employeeRepository.update.mockResolvedValue(makeEmployee({ position: 'Cajero' }));
    const out = await updateEmployee(USER_ID, { position: 'Cajero' });
    expect(employeeRepository.update).toHaveBeenCalledWith(USER_ID, { position: 'Cajero' });
    expect(out.position).toBe('Cajero');
    expect(findAuthUser).not.toHaveBeenCalled();
  });

  it('convierte la fecha de ingreso a Date UTC y deja pasar el telefono null', async () => {
    employeeRepository.update.mockResolvedValue(makeEmployee());
    await updateEmployee(USER_ID, { hireDate: '2026-04-01', phone: null });
    expect(employeeRepository.update).toHaveBeenCalledWith(USER_ID, {
      hireDate: new Date('2026-04-01T00:00:00Z'),
      phone: null,
    });
  });

  it('no agrega hireDate si no se envia', async () => {
    employeeRepository.update.mockResolvedValue(makeEmployee());
    await updateEmployee(USER_ID, { fullName: 'Nuevo Nombre' });
    expect(employeeRepository.update.mock.calls[0][1]).not.toHaveProperty('hireDate');
  });

  it('empleado inexistente (P2025) -> 404 NOT_FOUND', async () => {
    employeeRepository.update.mockRejectedValue(prismaError('P2025'));
    await expectAppError(updateEmployee(MISSING_ID, { position: 'X' }), 404, 'NOT_FOUND');
  });

  it('documento de otro empleado (P2002) -> 409 sobre documentNumber', async () => {
    employeeRepository.update.mockRejectedValue(prismaError('P2002', ['document_number']));
    const err = await expectAppError(
      updateEmployee(USER_ID, { documentNumber: '1' }),
      409,
      'CONFLICT',
    );
    expect(err.details).toEqual({ field: 'documentNumber' });
  });

  it('un error desconocido de la base se propaga sin traducir', async () => {
    const boom = new Error('db caida');
    employeeRepository.update.mockRejectedValue(boom);
    await expect(updateEmployee(USER_ID, { position: 'X' })).rejects.toBe(boom);
  });
});
