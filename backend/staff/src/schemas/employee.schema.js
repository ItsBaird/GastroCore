import { z } from 'zod';

// Limites de las columnas de employees (db/init/schema/staff.sql)
const fullName = z
  .string({ error: 'El nombre es obligatorio' })
  .trim()
  .min(1, 'El nombre es obligatorio')
  .max(150, 'El nombre admite hasta 150 caracteres');

const documentNumber = z
  .string({ error: 'El documento es obligatorio' })
  .trim()
  .min(1, 'El documento es obligatorio')
  .max(30, 'El documento admite hasta 30 caracteres');

const position = z
  .string({ error: 'El cargo es obligatorio' })
  .trim()
  .min(1, 'El cargo es obligatorio')
  .max(50, 'El cargo admite hasta 50 caracteres');

// El telefono es opcional; vacio o null se guarda como "sin telefono"
const phone = z
  .string()
  .trim()
  .max(30, 'El telefono admite hasta 30 caracteres')
  .nullable()
  .transform((v) => (v === '' ? null : v));

// Fecha de calendario AAAA-MM-DD (sin hora ni zona), y que exista de verdad (no 2026-02-31)
const hireDate = z
  .string({ error: 'La fecha de ingreso es obligatoria' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha de ingreso debe tener el formato AAAA-MM-DD')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'La fecha de ingreso no es valida');

export const userIdParamsSchema = z.object({
  userId: z.uuid('El userId debe ser un UUID valido'),
});

// CreateEmployeeRequest del contrato
export const createEmployeeSchema = z.object({
  userId: z.uuid('El userId debe ser un UUID valido'),
  fullName,
  phone: phone.optional(),
  documentNumber,
  position,
  hireDate,
});

// UpdateEmployeeRequest: cada campo es opcional; el userId no se puede cambiar
export const updateEmployeeSchema = z.object({
  fullName: fullName.optional(),
  phone: phone.optional(),
  documentNumber: documentNumber.optional(),
  position: position.optional(),
  hireDate: hireDate.optional(),
});
