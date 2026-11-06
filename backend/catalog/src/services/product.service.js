import { Prisma } from '@prisma/client';
import { AppError } from '../errors/AppError.js';
import { categoryRepository } from '../repositories/category.repository.js';
import { productRepository } from '../repositories/product.repository.js';
import { deletePhoto, detectImageType, savePhoto } from './photo.service.js';

export function toProduct(p) {
  return {
    productId: p.productId,
    categoryId: p.categoryId,
    name: p.name,
    description: p.description,
    price: p.price,
    photoUrl: p.photoUrl,
    isAvailable: p.isAvailable,
  };
}

// Mismo formato que los demas errores de validacion, para un campo que no es del JSON
export function fieldError(path, message) {
  return new AppError({
    status: 400,
    code: 'VALIDATION_ERROR',
    message: 'Datos de entrada invalidos',
    details: { fields: [{ path, message }] },
  });
}

// `file` es el archivo subido por multer (en memoria); `input` ya viene validado
export async function createProduct(input, file) {
  if (!file) throw fieldError('photo', 'La foto es obligatoria');

  const type = detectImageType(file.buffer);
  if (!type) throw fieldError('photo', 'La foto debe ser JPG, PNG o WebP');

  if (!(await categoryRepository.findById(input.categoryId))) {
    throw fieldError('categoryId', 'La categoria no existe');
  }

  // La foto se guarda antes del registro; si la base falla se borra para no dejar archivos huerfanos
  const photo = await savePhoto(file.buffer, type.ext);
  try {
    return toProduct(await productRepository.create({ ...input, photoUrl: photo.url }));
  } catch (err) {
    await deletePhoto(photo.filename);
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError({
        status: 409,
        code: 'CONFLICT',
        message: 'Ya existe un producto con ese nombre en la categoria',
        details: { field: 'name' },
      });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      throw fieldError('categoryId', 'La categoria no existe');
    }
    throw err;
  }
}
