import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors/AppError.js';
import { categoryRepository } from '../repositories/category.repository.js';
import { CATEGORY_ID, makeCategory } from '../test/helpers.js';
import { createCategory, listCategories, updateCategory } from './category.service.js';

vi.mock('../repositories/category.repository.js', () => ({
  categoryRepository: { findAll: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

const prismaError = (code) =>
  new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'test' });

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
});

describe('listCategories', () => {
  it('devuelve solo los campos del contrato (sin fechas)', async () => {
    categoryRepository.findAll.mockResolvedValue([
      makeCategory(),
      makeCategory({ categoryId: 'c2', name: 'Bebidas', displayOrder: null }),
    ]);
    expect(await listCategories()).toEqual([
      { categoryId: CATEGORY_ID, name: 'Pizzas', displayOrder: 1 },
      { categoryId: 'c2', name: 'Bebidas', displayOrder: null },
    ]);
  });

  it('sin categorias devuelve una lista vacia', async () => {
    categoryRepository.findAll.mockResolvedValue([]);
    expect(await listCategories()).toEqual([]);
  });
});

describe('createCategory', () => {
  it('crea y devuelve la categoria publica', async () => {
    categoryRepository.create.mockResolvedValue(makeCategory());
    const out = await createCategory({ name: 'Pizzas', displayOrder: 1 });
    expect(categoryRepository.create).toHaveBeenCalledWith({ name: 'Pizzas', displayOrder: 1 });
    expect(out).toEqual({ categoryId: CATEGORY_ID, name: 'Pizzas', displayOrder: 1 });
    expect(out).not.toHaveProperty('createdAt');
  });

  it('nombre repetido (P2002) -> 409 CONFLICT sobre el campo name', async () => {
    categoryRepository.create.mockRejectedValue(prismaError('P2002'));
    const err = await expectAppError(createCategory({ name: 'Pizzas' }), 409, 'CONFLICT');
    expect(err.details).toEqual({ field: 'name' });
  });

  it('un error desconocido se propaga sin traducir', async () => {
    const boom = new Error('db caida');
    categoryRepository.create.mockRejectedValue(boom);
    await expect(createCategory({ name: 'X' })).rejects.toBe(boom);
  });
});

describe('updateCategory', () => {
  it('actualiza y devuelve la categoria publica', async () => {
    categoryRepository.update.mockResolvedValue(
      makeCategory({ name: 'Pizzas XL', displayOrder: null }),
    );
    const out = await updateCategory(CATEGORY_ID, { name: 'Pizzas XL', displayOrder: null });
    expect(categoryRepository.update).toHaveBeenCalledWith(CATEGORY_ID, {
      name: 'Pizzas XL',
      displayOrder: null,
    });
    expect(out).toEqual({ categoryId: CATEGORY_ID, name: 'Pizzas XL', displayOrder: null });
  });

  it('nombre de otra categoria (P2002) -> 409 CONFLICT', async () => {
    categoryRepository.update.mockRejectedValue(prismaError('P2002'));
    await expectAppError(updateCategory(CATEGORY_ID, { name: 'Bebidas' }), 409, 'CONFLICT');
  });

  it('no existe (P2025) -> 404 NOT_FOUND', async () => {
    categoryRepository.update.mockRejectedValue(prismaError('P2025'));
    await expectAppError(updateCategory(CATEGORY_ID, { name: 'X' }), 404, 'NOT_FOUND');
  });

  it('un error desconocido se propaga sin traducir', async () => {
    const boom = new Error('db caida');
    categoryRepository.update.mockRejectedValue(boom);
    await expect(updateCategory(CATEGORY_ID, { name: 'X' })).rejects.toBe(boom);
  });
});
