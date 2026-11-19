import { Prisma } from '@prisma/client';
import { AppError } from '../errors/AppError.js';
import { categoryRepository } from '../repositories/category.repository.js';

const toCategory = ({ categoryId, name, displayOrder }) => ({ categoryId, name, displayOrder });

const isPrismaError = (err, code) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;

const nameTaken = () =>
  new AppError({
    status: 409,
    code: 'CONFLICT',
    message: 'Ya existe una categoria con ese nombre',
    details: { field: 'name' },
  });

export async function listCategories() {
  return (await categoryRepository.findAll()).map(toCategory);
}

export async function createCategory(input) {
  try {
    return toCategory(await categoryRepository.create(input));
  } catch (err) {
    if (isPrismaError(err, 'P2002')) throw nameTaken();
    throw err;
  }
}

export async function updateCategory(id, input) {
  try {
    return toCategory(await categoryRepository.update(id, input));
  } catch (err) {
    if (isPrismaError(err, 'P2002')) throw nameTaken();
    if (isPrismaError(err, 'P2025')) {
      throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Categoria no encontrada' });
    }
    throw err;
  }
}
