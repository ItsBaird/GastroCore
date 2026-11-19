// GET /internal/products (REQ-F03-05) con la app real. El repositorio va simulado.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { productRepository } from '../repositories/product.repository.js';
import { MISSING_ID, PRODUCT_ID, makeProduct, startApp, tokenFor } from '../test/helpers.js';

vi.mock('../repositories/product.repository.js', () => ({
  productRepository: { findByIds: vi.fn() },
}));

const TOKEN = 'token-de-pruebas'; // el mismo de test/setup.js
const URL = `/internal/products?ids=${PRODUCT_ID}`;

let app;

const get = async (path, headers = { 'X-Service-Token': TOKEN }) => {
  const res = await fetch(app.base + path, { headers });
  return { status: res.status, body: await res.json().catch(() => null) };
};

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  productRepository.findByIds.mockResolvedValue([]);
});

describe('GET /internal/products', () => {
  it('devuelve solo nombre, precio y disponibilidad', async () => {
    productRepository.findByIds.mockResolvedValue([
      makeProduct({ name: 'Agua', price: 2000, isAvailable: true }),
    ]);

    const res = await get(URL);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { productId: PRODUCT_ID, name: 'Agua', price: 2000, isAvailable: true },
    ]);
    expect(productRepository.findByIds).toHaveBeenCalledWith([PRODUCT_ID]);
  });

  it('informa los productos deshabilitados para que Orders los rechace', async () => {
    productRepository.findByIds.mockResolvedValue([makeProduct({ isAvailable: false })]);

    const res = await get(URL);

    expect(res.body[0].isAvailable).toBe(false);
  });

  it('un producto inexistente simplemente no aparece', async () => {
    const res = await get(`/internal/products?ids=${MISSING_ID}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('acepta varios ids separados por coma y descarta repetidos', async () => {
    await get(`/internal/products?ids=${PRODUCT_ID},${MISSING_ID},${PRODUCT_ID}`);

    expect(productRepository.findByIds).toHaveBeenCalledWith([PRODUCT_ID, MISSING_ID]);
  });

  it.each([
    ['sin cabecera', {}],
    ['con otro token', { 'X-Service-Token': 'otro' }],
    ['con un JWT de ADMIN', { Authorization: `Bearer ${tokenFor('ADMIN')}` }],
  ])('%s responde 401 y no consulta la base', async (_label, headers) => {
    const res = await get(URL, headers);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(productRepository.findByIds).not.toHaveBeenCalled();
  });

  it.each(['/internal/products', '/internal/products?ids=', '/internal/products?ids=no-es-uuid'])(
    '%s responde 400',
    async (path) => {
      const res = await get(path);

      expect(res.status).toBe(400);
      expect(productRepository.findByIds).not.toHaveBeenCalled();
    },
  );
});
