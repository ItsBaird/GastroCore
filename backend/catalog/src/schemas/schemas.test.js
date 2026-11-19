import { describe, expect, it } from 'vitest';
import { CATEGORY_ID } from '../test/helpers.js';
import { categoryIdParamsSchema, categoryInputSchema } from './category.schema.js';
import {
  createProductSchema,
  productIdParamsSchema,
  updateProductSchema,
} from './product.schema.js';

const base = { name: 'Pizza', price: '32000', categoryId: CATEGORY_ID };
const messages = (result) => result.error.issues.map((i) => i.message);

describe('categoryInputSchema', () => {
  it('recorta el nombre y acepta orden opcional, null o entero', () => {
    expect(categoryInputSchema.parse({ name: '  Pizzas ' })).toEqual({ name: 'Pizzas' });
    expect(categoryInputSchema.parse({ name: 'A', displayOrder: null })).toEqual({
      name: 'A',
      displayOrder: null,
    });
    expect(categoryInputSchema.parse({ name: 'A', displayOrder: 0 }).displayOrder).toBe(0);
    expect(categoryInputSchema.parse({ name: 'A', displayOrder: 10000 }).displayOrder).toBe(10000);
  });

  it.each([
    [{}, 'El nombre es obligatorio'],
    [{ name: '   ' }, 'El nombre es obligatorio'],
    [{ name: 'x'.repeat(81) }, 'El nombre admite hasta 80 caracteres'],
    [{ name: 'A', displayOrder: 1.5 }, 'El orden debe ser un numero entero'],
    [{ name: 'A', displayOrder: '3' }, 'El orden debe ser un numero entero'],
    [{ name: 'A', displayOrder: -1 }, 'El orden no puede ser negativo'],
    [{ name: 'A', displayOrder: 10001 }, 'El orden admite hasta 10000'],
  ])('rechaza %j', (input, message) => {
    expect(messages(categoryInputSchema.safeParse(input))).toContain(message);
  });
});

describe('createProductSchema', () => {
  it('convierte los textos del multipart: precio a numero y disponibilidad a booleano', () => {
    expect(createProductSchema.parse({ ...base, isAvailable: 'false' })).toMatchObject({
      price: 32000,
      isAvailable: false,
    });
    expect(createProductSchema.parse({ ...base, isAvailable: 'true' }).isAvailable).toBe(true);
  });

  it('isAvailable vale true por defecto y la descripcion vacia pasa a null', () => {
    const out = createProductSchema.parse({ ...base, description: '   ' });
    expect(out.isAvailable).toBe(true);
    expect(out.description).toBeNull();
    expect(createProductSchema.parse(base)).not.toHaveProperty('description');
  });

  it('acepta precio 0 y el maximo de 9 digitos', () => {
    expect(createProductSchema.parse({ ...base, price: '0' }).price).toBe(0);
    expect(createProductSchema.parse({ ...base, price: '999999999' }).price).toBe(999999999);
  });

  it.each(['-1', '10.5', '1e3', 'abc', '', '1000000000', '1 000'])(
    'rechaza el precio %j',
    (price) => {
      expect(createProductSchema.safeParse({ ...base, price }).success).toBe(false);
    },
  );

  it('rechaza nombre vacio o de mas de 120 caracteres, categoria no UUID e isAvailable invalido', () => {
    expect(createProductSchema.safeParse({ ...base, name: ' ' }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...base, name: 'x'.repeat(121) }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...base, categoryId: 'no-uuid' }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...base, isAvailable: 'si' }).success).toBe(false);
  });

  it('exige nombre, precio y categoria', () => {
    for (const key of ['name', 'price', 'categoryId']) {
      const rest = { ...base };
      delete rest[key];
      expect(createProductSchema.safeParse(rest).success).toBe(false);
    }
  });
});

describe('updateProductSchema', () => {
  it('todos los campos son opcionales y no se inventan valores por defecto', () => {
    expect(updateProductSchema.parse({})).toEqual({});
    expect(updateProductSchema.parse({ isAvailable: 'false' })).toEqual({ isAvailable: false });
    expect(updateProductSchema.parse({ price: '35000' })).toEqual({ price: 35000 });
  });

  it('valida los campos que si llegan', () => {
    expect(updateProductSchema.safeParse({ price: '-5' }).success).toBe(false);
    expect(updateProductSchema.safeParse({ categoryId: 'x' }).success).toBe(false);
    expect(updateProductSchema.safeParse({ name: '' }).success).toBe(false);
  });
});

describe('esquemas de parametros', () => {
  it('el id debe ser un UUID', () => {
    expect(productIdParamsSchema.safeParse({ id: CATEGORY_ID }).success).toBe(true);
    expect(productIdParamsSchema.safeParse({ id: '123' }).success).toBe(false);
    expect(categoryIdParamsSchema.safeParse({ id: CATEGORY_ID }).success).toBe(true);
    expect(categoryIdParamsSchema.safeParse({}).success).toBe(false);
  });
});
