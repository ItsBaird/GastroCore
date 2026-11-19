import { Prisma } from '@prisma/client';
import fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { categoryRepository } from '../repositories/category.repository.js';
import { productRepository } from '../repositories/product.repository.js';
import {
  CATEGORY_ID,
  JPEG,
  MISSING_ID,
  PNG,
  PRODUCT_ID,
  makeCategory,
  makeProduct,
} from '../test/helpers.js';
import { PHOTOS_URL_PREFIX, savePhoto } from './photo.service.js';
import {
  createProduct,
  fieldError,
  getProduct,
  getPublicMenu,
  listProducts,
  toProduct,
  updateProduct,
} from './product.service.js';

vi.mock('../repositories/category.repository.js', () => ({
  categoryRepository: { findById: vi.fn(), findMenu: vi.fn() },
}));
vi.mock('../repositories/product.repository.js', () => ({
  productRepository: { findAll: vi.fn(), findById: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

const OTHER_CATEGORY = '55555555-5555-4555-8555-555555555555';
const prismaError = (code) =>
  new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'test' });
const files = () => (fs.existsSync(env.uploadsDir) ? fs.readdirSync(env.uploadsDir) : []);
const upload = (buffer) => ({ buffer });

async function expectAppError(promise, status, code) {
  const err = await promise.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect({ status: err.status, code: err.code }).toEqual({ status, code });
  return err;
}

beforeEach(() => {
  vi.resetAllMocks();
  fs.rmSync(env.uploadsDir, { recursive: true, force: true });
});

describe('toProduct y fieldError', () => {
  it('toProduct expone solo los campos del contrato (sin fechas)', () => {
    expect(toProduct(makeProduct())).toEqual({
      productId: PRODUCT_ID,
      categoryId: CATEGORY_ID,
      name: 'Pizza Margarita',
      description: 'Tomate, mozzarella y albahaca',
      price: 32000,
      photoUrl: '/api/catalog/photos/x.jpg',
      isAvailable: true,
    });
  });

  it('fieldError arma un 400 VALIDATION_ERROR con el formato del resto de validaciones', () => {
    const err = fieldError('photo', 'La foto es obligatoria');
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.details).toEqual({ fields: [{ path: 'photo', message: 'La foto es obligatoria' }] });
  });
});

describe('listProducts / getProduct', () => {
  it('lista los productos en formato publico', async () => {
    productRepository.findAll.mockResolvedValue([makeProduct()]);
    const out = await listProducts();
    expect(out).toHaveLength(1);
    expect(out[0]).not.toHaveProperty('createdAt');
  });

  it('getProduct devuelve el producto', async () => {
    productRepository.findById.mockResolvedValue(makeProduct());
    expect((await getProduct(PRODUCT_ID)).productId).toBe(PRODUCT_ID);
  });

  it('getProduct de un id inexistente -> 404 NOT_FOUND', async () => {
    productRepository.findById.mockResolvedValue(null);
    await expectAppError(getProduct(MISSING_ID), 404, 'NOT_FOUND');
  });
});

describe('createProduct', () => {
  const input = { name: 'Pizza', price: 32000, categoryId: CATEGORY_ID, isAvailable: true };

  it('sin foto -> 400 y no consulta nada', async () => {
    await expectAppError(createProduct(input, undefined), 400, 'VALIDATION_ERROR');
    expect(categoryRepository.findById).not.toHaveBeenCalled();
  });

  it('foto que no es imagen -> 400 y no escribe en disco', async () => {
    await expectAppError(
      createProduct(input, upload(Buffer.from('hola mundo....'))),
      400,
      'VALIDATION_ERROR',
    );
    expect(files()).toEqual([]);
  });

  it('categoria inexistente -> 400 y no guarda la foto', async () => {
    categoryRepository.findById.mockResolvedValue(null);
    const err = await expectAppError(createProduct(input, upload(JPEG)), 400, 'VALIDATION_ERROR');
    expect(err.details.fields[0].path).toBe('categoryId');
    expect(files()).toEqual([]);
    expect(productRepository.create).not.toHaveBeenCalled();
  });

  it('guarda la foto y crea el producto con su photoUrl', async () => {
    categoryRepository.findById.mockResolvedValue(makeCategory());
    productRepository.create.mockImplementation(async (data) => makeProduct(data));
    const out = await createProduct(input, upload(PNG));
    const [filename] = files();
    expect(filename).toMatch(/\.png$/);
    expect(productRepository.create).toHaveBeenCalledWith({
      ...input,
      photoUrl: PHOTOS_URL_PREFIX + filename,
    });
    expect(out.photoUrl).toBe(PHOTOS_URL_PREFIX + filename);
  });

  it('nombre repetido (P2002) -> 409 y se borra la foto ya escrita', async () => {
    categoryRepository.findById.mockResolvedValue(makeCategory());
    productRepository.create.mockRejectedValue(prismaError('P2002'));
    const err = await expectAppError(createProduct(input, upload(JPEG)), 409, 'CONFLICT');
    expect(err.details).toEqual({ field: 'name' });
    expect(files()).toEqual([]);
  });

  it('FK de categoria (P2003) -> 400 sobre categoryId y se borra la foto', async () => {
    categoryRepository.findById.mockResolvedValue(makeCategory());
    productRepository.create.mockRejectedValue(prismaError('P2003'));
    const err = await expectAppError(createProduct(input, upload(JPEG)), 400, 'VALIDATION_ERROR');
    expect(err.details.fields[0].path).toBe('categoryId');
    expect(files()).toEqual([]);
  });

  it('error desconocido -> se propaga y se borra la foto', async () => {
    categoryRepository.findById.mockResolvedValue(makeCategory());
    const boom = new Error('db caida');
    productRepository.create.mockRejectedValue(boom);
    await expect(createProduct(input, upload(JPEG))).rejects.toBe(boom);
    expect(files()).toEqual([]);
  });
});

describe('updateProduct', () => {
  it('sin campos ni archivo -> 400 y no consulta la base', async () => {
    await expectAppError(updateProduct(PRODUCT_ID, {}, undefined), 400, 'VALIDATION_ERROR');
    expect(productRepository.findById).not.toHaveBeenCalled();
  });

  it('producto inexistente -> 404', async () => {
    productRepository.findById.mockResolvedValue(null);
    await expectAppError(updateProduct(MISSING_ID, { price: 1 }), 404, 'NOT_FOUND');
    expect(productRepository.update).not.toHaveBeenCalled();
  });

  it('actualiza solo los campos enviados (toggle de disponibilidad)', async () => {
    productRepository.findById.mockResolvedValue(makeProduct());
    productRepository.update.mockResolvedValue(makeProduct({ isAvailable: false }));
    const out = await updateProduct(PRODUCT_ID, { isAvailable: false });
    expect(productRepository.update).toHaveBeenCalledWith(PRODUCT_ID, { isAvailable: false });
    expect(out.isAvailable).toBe(false);
  });

  it('cambiar el precio no consulta categorias (R3: no toca Orders)', async () => {
    productRepository.findById.mockResolvedValue(makeProduct());
    productRepository.update.mockResolvedValue(makeProduct({ price: 35000 }));
    expect((await updateProduct(PRODUCT_ID, { price: 35000 })).price).toBe(35000);
    expect(categoryRepository.findById).not.toHaveBeenCalled();
  });

  it('la misma categoria no se vuelve a comprobar; una distinta si', async () => {
    productRepository.findById.mockResolvedValue(makeProduct());
    productRepository.update.mockResolvedValue(makeProduct());
    await updateProduct(PRODUCT_ID, { categoryId: CATEGORY_ID });
    expect(categoryRepository.findById).not.toHaveBeenCalled();

    categoryRepository.findById.mockResolvedValue(makeCategory({ categoryId: OTHER_CATEGORY }));
    await updateProduct(PRODUCT_ID, { categoryId: OTHER_CATEGORY });
    expect(categoryRepository.findById).toHaveBeenCalledWith(OTHER_CATEGORY);
  });

  it('categoria nueva inexistente -> 400 sobre categoryId', async () => {
    productRepository.findById.mockResolvedValue(makeProduct());
    categoryRepository.findById.mockResolvedValue(null);
    const err = await expectAppError(
      updateProduct(PRODUCT_ID, { categoryId: OTHER_CATEGORY }),
      400,
      'VALIDATION_ERROR',
    );
    expect(err.details.fields[0].path).toBe('categoryId');
    expect(productRepository.update).not.toHaveBeenCalled();
  });

  it('archivo que no es imagen -> 400 y no escribe en disco', async () => {
    productRepository.findById.mockResolvedValue(makeProduct());
    await expectAppError(
      updateProduct(PRODUCT_ID, {}, upload(Buffer.from('no es imagen'))),
      400,
      'VALIDATION_ERROR',
    );
    expect(files()).toEqual([]);
  });

  it('foto nueva: se guarda, se actualiza photoUrl y se borra la anterior', async () => {
    const old = await savePhoto(JPEG, 'jpg');
    productRepository.findById.mockResolvedValue(makeProduct({ photoUrl: old.url }));
    productRepository.update.mockImplementation(async (_id, data) => makeProduct(data));
    const out = await updateProduct(PRODUCT_ID, {}, upload(PNG));
    const remaining = files();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).not.toBe(old.filename);
    expect(out.photoUrl).toBe(PHOTOS_URL_PREFIX + remaining[0]);
  });

  it('una photoUrl ajena a /api/catalog/photos/ no se intenta borrar', async () => {
    productRepository.findById.mockResolvedValue(
      makeProduct({ photoUrl: 'https://cdn.ejemplo.com/a.jpg' }),
    );
    productRepository.update.mockImplementation(async (_id, data) => makeProduct(data));
    await updateProduct(PRODUCT_ID, {}, upload(JPEG));
    expect(files()).toHaveLength(1);
  });

  it('si falla la actualizacion se borra la foto nueva y se conserva la anterior', async () => {
    const old = await savePhoto(JPEG, 'jpg');
    productRepository.findById.mockResolvedValue(makeProduct({ photoUrl: old.url }));
    productRepository.update.mockRejectedValue(prismaError('P2002'));
    await expectAppError(
      updateProduct(PRODUCT_ID, { name: 'Repetido' }, upload(PNG)),
      409,
      'CONFLICT',
    );
    expect(files()).toEqual([old.filename]);
  });

  it('P2025 al actualizar (borrado concurrente) -> 404', async () => {
    productRepository.findById.mockResolvedValue(makeProduct());
    productRepository.update.mockRejectedValue(prismaError('P2025'));
    await expectAppError(updateProduct(PRODUCT_ID, { price: 1 }), 404, 'NOT_FOUND');
  });
});

describe('getPublicMenu', () => {
  it('expone categoria y productos solo con los campos publicos', async () => {
    categoryRepository.findMenu.mockResolvedValue([makeCategory({ products: [makeProduct()] })]);
    expect(await getPublicMenu()).toEqual([
      {
        categoryId: CATEGORY_ID,
        name: 'Pizzas',
        products: [
          {
            productId: PRODUCT_ID,
            name: 'Pizza Margarita',
            description: 'Tomate, mozzarella y albahaca',
            price: 32000,
            photoUrl: '/api/catalog/photos/x.jpg',
          },
        ],
      },
    ]);
  });

  it('no filtra isAvailable, categoryId del producto, displayOrder ni fechas', async () => {
    categoryRepository.findMenu.mockResolvedValue([makeCategory({ products: [makeProduct()] })]);
    const [cat] = await getPublicMenu();
    expect(cat).not.toHaveProperty('displayOrder');
    expect(Object.keys(cat.products[0]).sort()).toEqual([
      'description',
      'name',
      'photoUrl',
      'price',
      'productId',
    ]);
  });

  it('sin categorias con productos disponibles devuelve []', async () => {
    categoryRepository.findMenu.mockResolvedValue([]);
    expect(await getPublicMenu()).toEqual([]);
  });
});
