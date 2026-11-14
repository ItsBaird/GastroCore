import { AppError } from '../errors/AppError.js';
import {
  countPaymentsByMethod,
  createPaymentMethod,
  findAllPaymentMethods,
  findPaymentMethodById,
  findPaymentMethodByName,
  updatePaymentMethod,
} from '../repositories/paymentMethod.repository.js';

function toResponse(method) {
  return {
    paymentMethodId: method.paymentMethodId,
    name: method.name,
    isCash: method.isCash,
    isActive: method.isActive,
  };
}

const nameTaken = () =>
  new AppError({
    status: 409,
    code: 'CONFLICT',
    message: 'Ya existe un metodo de pago con ese nombre',
    details: { field: 'name' },
  });

const lockedByPayments = (locked) =>
  new AppError({
    status: 409,
    code: 'CONFLICT',
    message:
      'Este metodo ya tiene pagos registrados: no se puede cambiar su nombre ni si es efectivo. Desactivalo y crea uno nuevo',
    details: { locked },
  });

function isPrismaUniqueViolation(err) {
  return err?.code === 'P2002';
}

// El nombre debe ser unico sin distinguir mayusculas. `ownId` excluye al propio metodo al editarlo
// (para poder, por ejemplo, corregir "efectivo" por "Efectivo"). La restriccion unica de la base
// cubre ademas la carrera entre dos peticiones simultaneas (P2002).
async function assertNameFree(name, ownId) {
  const found = await findPaymentMethodByName(name);
  if (found && found.paymentMethodId !== ownId) throw nameTaken();
}

// `active` undefined = todos. Los meseros piden solo los activos para el cobro.
export async function listPaymentMethodsService({ active } = {}) {
  const methods = await findAllPaymentMethods({ active });
  return methods.map(toResponse);
}

export async function createPaymentMethodService({ name, isCash, isActive }) {
  await assertNameFree(name);
  try {
    return toResponse(await createPaymentMethod({ name, isCash, isActive }));
  } catch (err) {
    if (isPrismaUniqueViolation(err)) throw nameTaken();
    throw err;
  }
}

// Editar y desactivar son el mismo PUT. Desactivar no borra nada: el metodo deja de ofrecerse al
// cobrar (GET ?active=true) pero los pagos y cierres historicos que lo referencian se conservan.
// Con pagos registrados NO se puede cambiar `name` ni `isCash`: payments guarda solo el id del metodo, asi que
// renombrarlo o cambiarle el tipo reescribiria el historial y el cierre de caja de dias anteriores. Lo que
// no cambia (un PUT que repite el mismo nombre) se acepta; `isActive` siempre se puede cambiar. Para otro
// nombre o tipo: crear un metodo nuevo y desactivar el viejo.
export async function updatePaymentMethodService(id, changes) {
  const existing = await findPaymentMethodById(id);
  if (!existing) {
    throw new AppError({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Metodo de pago no encontrado',
    });
  }

  const locked = [];
  if (changes.name !== existing.name) locked.push('name');
  if (changes.isCash !== undefined && changes.isCash !== existing.isCash) locked.push('isCash');
  if (locked.length > 0 && (await countPaymentsByMethod(id)) > 0) throw lockedByPayments(locked);

  await assertNameFree(changes.name, id);
  try {
    return toResponse(await updatePaymentMethod(id, changes));
  } catch (err) {
    if (isPrismaUniqueViolation(err)) throw nameTaken();
    throw err;
  }
}
