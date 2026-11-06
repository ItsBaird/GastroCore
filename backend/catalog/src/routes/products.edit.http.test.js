// Lectura y edicion de productos (GC-76) y menu publico (GC-77) con la app real.
// Solo los repositorios van simulados: no hace falta base de datos.
import { Prisma } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { categoryRepository } from '../repositories/category.repository.js';
import { productRepository } from '../repositories/product.repository.js';
import {
  CATEGORY_ID,
  JPEG,
  MISSING_ID,
  PNG,
  PRODUCT_ID,
  call,
  makeCategory,
  makeProduct,
  startApp,
  tokenFor,
} from '../test/helpers.js';

vi.mock('../repositories/category.repository.js', () => ({
  categoryRepository: { findById: vi.fn(), findMenu: vi.fn() },
}));
vi.mock('../repositories/product.repository.js', () => ({
  productRepository: { findAll: vi.fn(), findById: vi.fn(), update: vi.fn() },
}));

let app;
const admin = () => tokenFor('ADMIN');
const prismaError = (code) =>
  new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'test' });
const form = (fields = {}, photo) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  if (photo) f.append('photo', new Blob([photo]), 'nueva.png');
  return f;
};
const put = (id, body, token = admin()) =>
  call(app.base, 'PUT', `/api/catalog/products/${id}`, { token, body });
const dir = () => process.env.UPLOADS_DIR;

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  fs.rmSync(dir(), { recursive: true, force: true });
  productRepository.findById.mockResolvedValue(makeProduct());
  productRepository.update.mockImplementation(async (id, data) => makeProduct(data));
});

describe('GET /api/catalog/products y /:id', () => {
  it('sin token -> 401', async () => {
    expect((await call(app.base, 'GET', '/api/catalog/products')).status).toBe(401);
    expect((await call(app.base, 'GET', `/api/catalog/products/${PRODUCT_ID}`)).status).toBe(401);
  });

  it.each(['ADMIN', 'WAITER', 'COOK'])(
    '%s lista los productos, tambien los agotados',
    async (role) => {
      productRepository.findAll.mockResolvedValue([
        makeProduct(),
        makeProduct({ productId: MISSING_ID, isAvailable: false }),
      ]);
      const res = await call(app.base, 'GET', '/api/catalog/products', { token: tokenFor(role) });
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[1].isAvailable).toBe(false);
      expect(res.body[0]).not.toHaveProperty('createdAt');
    },
  );

  it('obtiene un producto', async () => {
    const res = await call(app.base, 'GET', `/api/catalog/products/${PRODUCT_ID}`, {
      token: tokenFor('WAITER'),
    });
    expect(res.status).toBe(200);
    expect(res.body.productId).toBe(PRODUCT_ID);
  });

  it('inexistente -> 404 y id no UUID -> 400', async () => {
    productRepository.findById.mockResolvedValue(null);
    const t = admin();
    expect(
      (await call(app.base, 'GET', `/api/catalog/products/${MISSING_ID}`, { token: t })).status,
    ).toBe(404);
    expect((await call(app.base, 'GET', '/api/catalog/products/abc', { token: t })).status).toBe(
      400,
    );
  });
});

describe('PUT /api/catalog/products/:id', () => {
  it('sin token -> 401; WAITER -> 403 sin tocar nada', async () => {
    expect((await put(PRODUCT_ID, form({ price: '1' }), null)).status).toBe(401);
    const res = await put(PRODUCT_ID, form({ price: '1' }, PNG), tokenFor('WAITER'));
    expect(res.status).toBe(403);
    expect(productRepository.update).not.toHaveBeenCalled();
    expect(fs.existsSync(dir())).toBe(false);
  });

  it('editar el precio actualiza solo ese campo (criterio 2)', async () => {
    const res = await put(PRODUCT_ID, form({ price: '35000' }));
    expect(res.status).toBe(200);
    expect(res.body.price).toBe(35000);
    expect(productRepository.update).toHaveBeenCalledWith(PRODUCT_ID, { price: 35000 });
  });

  it('el interruptor de disponibilidad solo envia isAvailable (criterio 3)', async () => {
    const res = await put(PRODUCT_ID, form({ isAvailable: 'false' }));
    expect(res.status).toBe(200);
    expect(res.body.isAvailable).toBe(false);
    expect(productRepository.update).toHaveBeenCalledWith(PRODUCT_ID, { isAvailable: false });
  });

  it('edita varios campos, y una descripcion vacia la borra', async () => {
    await put(PRODUCT_ID, form({ name: '  Nueva  ', description: '', categoryId: CATEGORY_ID }));
    expect(productRepository.update).toHaveBeenCalledWith(PRODUCT_ID, {
      name: 'Nueva',
      description: null,
      categoryId: CATEGORY_ID,
    });
  });

  it('cambiar de categoria exige que exista', async () => {
    const other = '55555555-5555-4555-8555-555555555555';
    categoryRepository.findById.mockResolvedValue(null);
    const res = await put(PRODUCT_ID, form({ categoryId: other }));
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields[0].path).toBe('categoryId');
    expect(productRepository.update).not.toHaveBeenCalled();

    categoryRepository.findById.mockResolvedValue(makeCategory({ categoryId: other }));
    expect((await put(PRODUCT_ID, form({ categoryId: other }))).status).toBe(200);
  });

  it('reemplazar la foto guarda la nueva y borra la anterior', async () => {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(path.join(dir(), 'vieja.jpg'), JPEG);
    productRepository.findById.mockResolvedValue(
      makeProduct({ photoUrl: '/api/catalog/photos/vieja.jpg' }),
    );
    const res = await put(PRODUCT_ID, form({}, PNG));
    expect(res.status).toBe(200);
    expect(res.body.photoUrl).toMatch(/^\/api\/catalog\/photos\/[0-9a-f-]{36}\.png$/);
    expect(fs.readdirSync(dir())).toEqual([res.body.photoUrl.split('/').pop()]);
  });

  it('si falla la actualizacion la foto nueva no queda huerfana y la vieja se conserva', async () => {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(path.join(dir(), 'vieja.jpg'), JPEG);
    productRepository.findById.mockResolvedValue(
      makeProduct({ photoUrl: '/api/catalog/photos/vieja.jpg' }),
    );
    productRepository.update.mockRejectedValue(prismaError('P2002'));
    const res = await put(PRODUCT_ID, form({ name: 'Repetido' }, PNG));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(fs.readdirSync(dir())).toEqual(['vieja.jpg']);
  });

  it('un archivo que no es imagen -> 400 y no se escribe nada', async () => {
    const res = await put(PRODUCT_ID, form({}, Buffer.from('no soy una imagen')));
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields[0].path).toBe('photo');
    expect(fs.existsSync(dir())).toBe(false);
  });

  it('foto de mas de 2 MB -> 400', async () => {
    const res = await put(
      PRODUCT_ID,
      form({}, Buffer.concat([JPEG, Buffer.alloc(2 * 1024 * 1024)])),
    );
    expect(res.status).toBe(400);
    expect(productRepository.update).not.toHaveBeenCalled();
  });

  it('sin ningun campo ni foto -> 400', async () => {
    const res = await put(PRODUCT_ID, form({}));
    expect(res.status).toBe(400);
    expect(productRepository.update).not.toHaveBeenCalled();
  });

  it.each([
    ['precio decimal', { price: '10.5' }],
    ['precio negativo', { price: '-5' }],
    ['nombre vacio', { name: '  ' }],
    ['isAvailable invalido', { isAvailable: 'si' }],
    ['categoria que no es UUID', { categoryId: 'x' }],
  ])('%s -> 400', async (_, fields) => {
    const res = await put(PRODUCT_ID, form(fields));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(productRepository.update).not.toHaveBeenCalled();
  });

  it('producto inexistente -> 404 y no se guarda la foto', async () => {
    productRepository.findById.mockResolvedValue(null);
    const res = await put(MISSING_ID, form({ price: '1' }, PNG));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(fs.existsSync(dir())).toBe(false);
  });

  it('nombre repetido en la categoria -> 409', async () => {
    productRepository.update.mockRejectedValue(prismaError('P2002'));
    expect((await put(PRODUCT_ID, form({ name: 'Repetido' }))).status).toBe(409);
  });
});

describe('GET /api/catalog/public/menu (sin login)', () => {
  it('responde sin token con el formato MenuCategory', async () => {
    categoryRepository.findMenu.mockResolvedValue([
      { ...makeCategory(), products: [makeProduct()] },
    ]);
    const res = await call(app.base, 'GET', '/api/catalog/public/menu');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.body).toEqual([
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

  it('no expone campos internos (disponibilidad, fechas)', async () => {
    categoryRepository.findMenu.mockResolvedValue([
      { ...makeCategory(), products: [makeProduct()] },
    ]);
    const res = await call(app.base, 'GET', '/api/catalog/public/menu');
    expect(res.body[0]).not.toHaveProperty('displayOrder');
    expect(res.body[0].products[0]).not.toHaveProperty('isAvailable');
    expect(res.body[0].products[0]).not.toHaveProperty('createdAt');
  });

  it('sin productos disponibles devuelve una lista vacia', async () => {
    categoryRepository.findMenu.mockResolvedValue([]);
    const res = await call(app.base, 'GET', '/api/catalog/public/menu');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
