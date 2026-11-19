import { describe, expect, it } from 'vitest';
import { USER_ID } from '../test/helpers.js';
import {
  createEmployeeSchema,
  updateEmployeeSchema,
  userIdParamsSchema,
} from './employee.schema.js';

const base = {
  userId: USER_ID,
  fullName: 'Carlos Rodriguez',
  documentNumber: '1012345678',
  position: 'Mesero',
  hireDate: '2026-03-15',
};
const messages = (result) => result.error.issues.map((i) => i.message);

describe('createEmployeeSchema', () => {
  it('acepta un empleado completo y recorta los espacios', () => {
    const out = createEmployeeSchema.parse({
      ...base,
      fullName: '  Ana Martinez ',
      documentNumber: ' 52000111 ',
      position: ' Cocinera ',
      phone: ' 3001234567 ',
    });
    expect(out).toMatchObject({
      fullName: 'Ana Martinez',
      documentNumber: '52000111',
      position: 'Cocinera',
      phone: '3001234567',
    });
  });

  it('el telefono es opcional: omitido no aparece; vacio o null pasan a null', () => {
    expect(createEmployeeSchema.parse(base)).not.toHaveProperty('phone');
    expect(createEmployeeSchema.parse({ ...base, phone: '   ' }).phone).toBeNull();
    expect(createEmployeeSchema.parse({ ...base, phone: null }).phone).toBeNull();
  });

  it('acepta los limites exactos de las columnas', () => {
    const out = createEmployeeSchema.parse({
      ...base,
      fullName: 'x'.repeat(150),
      documentNumber: '9'.repeat(30),
      position: 'x'.repeat(50),
      phone: '3'.repeat(30),
    });
    expect(out.fullName).toHaveLength(150);
  });

  it.each([
    ['fullName', 'x'.repeat(151), 'El nombre admite hasta 150 caracteres'],
    ['documentNumber', '9'.repeat(31), 'El documento admite hasta 30 caracteres'],
    ['position', 'x'.repeat(51), 'El cargo admite hasta 50 caracteres'],
    ['phone', '3'.repeat(31), 'El telefono admite hasta 30 caracteres'],
  ])('%s: rechaza pasarse del limite', (field, value, message) => {
    expect(messages(createEmployeeSchema.safeParse({ ...base, [field]: value }))).toContain(
      message,
    );
  });

  it.each([
    ['fullName', 'El nombre es obligatorio'],
    ['documentNumber', 'El documento es obligatorio'],
    ['position', 'El cargo es obligatorio'],
  ])('%s: es obligatorio, no vale vacio ni solo espacios ni omitido', (field, message) => {
    expect(messages(createEmployeeSchema.safeParse({ ...base, [field]: '' }))).toContain(message);
    expect(messages(createEmployeeSchema.safeParse({ ...base, [field]: '   ' }))).toContain(
      message,
    );
    const omitted = { ...base };
    delete omitted[field];
    expect(messages(createEmployeeSchema.safeParse(omitted))).toContain(message);
  });

  it('rechaza valores que no son texto', () => {
    expect(createEmployeeSchema.safeParse({ ...base, fullName: 123 }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...base, documentNumber: 1012345678 }).success).toBe(
      false,
    );
  });

  it('userId debe ser un UUID y es obligatorio', () => {
    expect(createEmployeeSchema.safeParse({ ...base, userId: 'no-uuid' }).success).toBe(false);
    const omitted = { ...base };
    delete omitted.userId;
    expect(createEmployeeSchema.safeParse(omitted).success).toBe(false);
  });

  it.each(['2026-03-15', '2024-02-29', '1999-12-31', '2026-01-01'])(
    'acepta la fecha %s',
    (hireDate) => {
      expect(createEmployeeSchema.parse({ ...base, hireDate }).hireDate).toBe(hireDate);
    },
  );

  it.each([
    '15/03/2026',
    '2026-3-5',
    '2026-02-31',
    '2027-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-04-31',
    '2026-03-15T10:00:00Z',
    'hoy',
    '',
  ])('rechaza la fecha %j', (hireDate) => {
    expect(createEmployeeSchema.safeParse({ ...base, hireDate }).success).toBe(false);
  });

  it('la fecha de ingreso es obligatoria', () => {
    const omitted = { ...base };
    delete omitted.hireDate;
    expect(messages(createEmployeeSchema.safeParse(omitted))).toContain(
      'La fecha de ingreso es obligatoria',
    );
  });
});

describe('updateEmployeeSchema', () => {
  it('todos los campos son opcionales y no inventa valores por defecto', () => {
    expect(updateEmployeeSchema.parse({})).toEqual({});
    expect(updateEmployeeSchema.parse({ position: ' Cajero ' })).toEqual({ position: 'Cajero' });
  });

  it('el userId no se puede cambiar: se descarta si llega', () => {
    expect(updateEmployeeSchema.parse({ userId: USER_ID, position: 'Cajero' })).toEqual({
      position: 'Cajero',
    });
  });

  it('el telefono se puede borrar con "" o null', () => {
    expect(updateEmployeeSchema.parse({ phone: '' })).toEqual({ phone: null });
    expect(updateEmployeeSchema.parse({ phone: null })).toEqual({ phone: null });
  });

  it('valida los campos que si llegan', () => {
    expect(updateEmployeeSchema.safeParse({ fullName: '' }).success).toBe(false);
    expect(updateEmployeeSchema.safeParse({ documentNumber: '  ' }).success).toBe(false);
    expect(updateEmployeeSchema.safeParse({ hireDate: '2026-02-30' }).success).toBe(false);
    expect(updateEmployeeSchema.safeParse({ position: 'x'.repeat(51) }).success).toBe(false);
    expect(updateEmployeeSchema.safeParse({ hireDate: '2026-04-01' }).success).toBe(true);
  });
});

describe('userIdParamsSchema', () => {
  it('el userId de la ruta debe ser un UUID', () => {
    expect(userIdParamsSchema.safeParse({ userId: USER_ID }).success).toBe(true);
    expect(userIdParamsSchema.safeParse({ userId: '123' }).success).toBe(false);
    expect(userIdParamsSchema.safeParse({}).success).toBe(false);
  });
});
