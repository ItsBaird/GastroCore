import { Prisma } from '@prisma/client';
import { AppError } from '../errors/AppError.js';
import { categoryRepository } from '../repositories/category.repository.js';
import { productRepository } from '../repositories/product.repository.js';
import { PHOTOS_URL_PREFIX, deletePhoto, detectImageType, savePhoto } from './photo.service.js';

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

const notFound = () =>
  new AppError({ status: 404, code: 'NOT_FOUND', message: 'Producto no encontrado' });

const isPrismaError = (err, code) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;

// Traduce los errores de base de datos al contrato (409 nombre repetido, 400 categoria inexistente)
function mapWriteError(err) {
  if (isPrismaError(err, 'P2002')) {
    return new AppError({
      status: 409,
      code: 'CONFLICT',
      message: 'Ya existe un producto con ese nombre en la categoria',
      details: { field: 'name' },
    });
  }
  if (isPrismaError(err, 'P2003')) return fieldError('categoryId', 'La categoria no existe');
  if (isPrismaError(err, 'P2025')) return notFound();
  return err;
}

export async function listProducts() {
  return (await productRepository.findAll()).map(toProduct);
}

// Consulta interna de Orders: lo justo para validar la ronda y copiar el snapshot (R3)
export async function listProductsForOrders(productIds) {
  const products = await productRepository.findByIds(productIds);
  return products.map(({ productId, name, price, isAvailable }) => ({
    productId,
    name,
    price,
    isAvailable,
  }));
}

export async function getProduct(id) {
  const product = await productRepository.findById(id);
  if (!product) throw notFound();
  return toProduct(product);
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
    throw mapWriteError(err);
  }
}

// R3: cambiar el precio solo afecta al producto del catalogo. Los items de ordenes existentes
// guardan su propio snapshot (se copia al crear la ronda), asi que aqui no se toca nada de Orders.
export async function updateProduct(id, input, file) {
  if (Object.keys(input).length === 0 && !file) {
    throw fieldError('body', 'Envia al menos un campo para modificar');
  }

  const current = await productRepository.findById(id);
  if (!current) throw notFound();

  let type = null;
  if (file) {
    type = detectImageType(file.buffer);
    if (!type) throw fieldError('photo', 'La foto debe ser JPG, PNG o WebP');
  }
  if (
    input.categoryId &&
    input.categoryId !== current.categoryId &&
    !(await categoryRepository.findById(input.categoryId))
  ) {
    throw fieldError('categoryId', 'La categoria no existe');
  }

  const photo = file ? await savePhoto(file.buffer, type.ext) : null;
  let updated;
  try {
    updated = await productRepository.update(id, {
      ...input,
      ...(photo && { photoUrl: photo.url }),
    });
  } catch (err) {
    if (photo) await deletePhoto(photo.filename);
    throw mapWriteError(err);
  }

  // Foto reemplazada: la anterior ya no la usa nadie
  if (photo && current.photoUrl.startsWith(PHOTOS_URL_PREFIX)) {
    await deletePhoto(current.photoUrl.slice(PHOTOS_URL_PREFIX.length));
  }
  return toProduct(updated);
}

// Menu publico: solo lo que ve el cliente (sin banderas internas ni fechas)
export async function getPublicMenu() {
  const categories = await categoryRepository.findMenu();
  return categories.map((c) => ({
    categoryId: c.categoryId,
    name: c.name,
    products: c.products.map(({ productId, name, description, price, photoUrl }) => ({
      productId,
      name,
      description,
      price,
      photoUrl,
    })),
  }));
}
