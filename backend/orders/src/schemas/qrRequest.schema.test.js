import { describe, expect, it } from 'vitest';
import {
  MAX_ITEMS_PER_REQUEST,
  MAX_QUANTITY_PER_ITEM,
  qrRequestBodySchema,
} from './qrRequest.schema.js';

const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const item = (over = {}) => ({ productId: P1, quantity: 1, ...over });
const parse = (items) => qrRequestBodySchema.safeParse({ items });
const messages = (result) => result.error.issues.map((i) => i.message);

describe('qrRequestBodySchema', () => {
  it('acepta productos, cantidades y notas', () => {
    const out = qrRequestBodySchema.parse({ items: [item({ quantity: 3, note: 'sin cebolla' })] });
    expect(out.items[0]).toEqual({ productId: P1, quantity: 3, note: 'sin cebolla' });
  });

  it('la nota es opcional; recortada, y vacia equivale a no enviarla', () => {
    expect(qrRequestBodySchema.parse({ items: [item()] }).items[0]).not.toHaveProperty('note');
    expect(qrRequestBodySchema.parse({ items: [item({ note: '  hola  ' })] }).items[0].note).toBe(
      'hola',
    );
    expect(
      qrRequestBodySchema.parse({ items: [item({ note: '   ' })] }).items[0].note,
    ).toBeUndefined();
  });

  it(`los limites: 1 a ${MAX_ITEMS_PER_REQUEST} items, cantidad de 1 a ${MAX_QUANTITY_PER_ITEM}, nota de hasta 255`, () => {
    expect(parse(Array.from({ length: MAX_ITEMS_PER_REQUEST }, () => item())).success).toBe(true);
    expect(parse(Array.from({ length: MAX_ITEMS_PER_REQUEST + 1 }, () => item())).success).toBe(
      false,
    );
    expect(parse([]).success).toBe(false);
    expect(parse([item({ quantity: MAX_QUANTITY_PER_ITEM })]).success).toBe(true);
    expect(parse([item({ quantity: MAX_QUANTITY_PER_ITEM + 1 })]).success).toBe(false);
    expect(parse([item({ quantity: 1 })]).success).toBe(true);
    expect(parse([item({ quantity: 0 })]).success).toBe(false);
    expect(parse([item({ note: 'x'.repeat(255) })]).success).toBe(true);
    expect(parse([item({ note: 'x'.repeat(256) })]).success).toBe(false);
  });

  it('la cantidad debe ser un entero numerico', () => {
    for (const quantity of [1.5, '2', null, NaN, 2 ** 31]) {
      expect(parse([item({ quantity })]).success).toBe(false);
    }
  });

  it('el productId debe ser un UUID', () => {
    expect(messages(parse([item({ productId: 'pizza' })]))).toContain(
      'El producto debe ser un UUID valido',
    );
  });

  it('rechaza cualquier campo que no sea del contrato (precio, estado, orden, mesa)', () => {
    expect(parse([item({ unitPrice: 1 })]).success).toBe(false);
    expect(parse([item({ price: 1 })]).success).toBe(false);
    expect(qrRequestBodySchema.safeParse({ items: [item()], status: 'confirmada' }).success).toBe(
      false,
    );
    expect(qrRequestBodySchema.safeParse({ items: [item()], orderId: P1 }).success).toBe(false);
    expect(qrRequestBodySchema.safeParse({ items: [item()], tableId: P1 }).success).toBe(false);
  });

  it('exige el arreglo items', () => {
    expect(qrRequestBodySchema.safeParse({}).success).toBe(false);
    expect(qrRequestBodySchema.safeParse({ items: 'x' }).success).toBe(false);
    expect(qrRequestBodySchema.safeParse(null).success).toBe(false);
  });
});
