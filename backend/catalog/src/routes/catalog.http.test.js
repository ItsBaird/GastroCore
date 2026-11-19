// Categorias y alta de productos con la app real (rutas, validacion, autenticacion, multer, errores).
// Solo los repositorios van simulados: no hace falta base de datos.
import { Prisma } from '@prisma/client';
import fs from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { categoryRepository } from '../repositories/category.repository.js';
import { productRepository } from '../repositories/product.repository.js';
import {
  CATEGORY_ID,
  JPEG,
  MISSING_ID,
  PNG,
  WEBP,
  call,
  makeCategory,
  makeProduct,
  productForm,
  startApp,
  tokenFor,
} from '../test/helpers.js';

vi.mock('../repositories/category.repository.js', () => ({
  categoryRepository: { findAll: vi.fn(), findById: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
vi.mock('../repositories/product.repository.js', () => ({
  productRepository: { create: vi.fn() },
}));

let app;
const admin = () => tokenFor('ADMIN');
const uploaded = () => fs.readdirSync(process.env.UPLOADS_DIR, { withFileTypes: true });
const prismaError = (code) =>
  new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'test' });

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  fs.rmSync(process.env.UPLOADS_DIR, { recursive: true, force: true });
});

describe('acceso', () => {
  const rutas = [
    ['POST', '/api/catalog/categories', { name: 'Postres' }],
    ['PUT', `/api/catalog/categories/${CATEGORY_ID}`, { name: 'Postres' }],
    ['POST', '/api/catalog/products', () => productForm()],
  ];
  const cuerpo = (b) => (typeof b === 'function' ? b() : b);

  it('GET /categories sin token -> 401', async () => {
    const res = await call(app.base, 'GET', '/api/catalog/categories');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it.each(rutas)('%s %s sin token -> 401', async (method, path, body) => {
    const res = await call(app.base, method, path, { body: cuerpo(body) });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it.each(rutas)('%s %s con token de WAITER -> 403 y no toca nada', async (method, path, body) => {
    const res = await call(app.base, method, path, {
      body: cuerpo(body),
      token: tokenFor('WAITER'),
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(categoryRepository.create).not.toHaveBeenCalled();
    expect(productRepository.create).not.toHaveBeenCalled();
    expect(fs.existsSync(process.env.UPLOADS_DIR)).toBe(false);
  });
});

describe('GET /api/catalog/categories', () => {
  it.each(['ADMIN', 'WAITER', 'COOK'])('lo puede consultar %s', async (role) => {
    categoryRepository.findAll.mockResolvedValue([makeCategory()]);
    const res = await call(app.base, 'GET', '/api/catalog/categories', { token: tokenFor(role) });
    expect(res.status).toBe(200);
    // Solo los campos del contrato (sin createdAt)
    expect(res.body).toEqual([{ categoryId: CATEGORY_ID, name: 'Pizzas', displayOrder: 1 }]);
  });
});

describe('POST /api/catalog/categories', () => {
  it('crea la categoria -> 201', async () => {
    categoryRepository.create.mockResolvedValue(
      makeCategory({ name: 'Postres', displayOrder: null }),
    );
    const res = await call(app.base, 'POST', '/api/catalog/categories', {
      token: admin(),
      body: { name: '  Postres  ' },
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ categoryId: CATEGORY_ID, name: 'Postres', displayOrder: null });
    expect(categoryRepository.create).toHaveBeenCalledWith({ name: 'Postres' });
  });

  it.each([
    ['sin nombre', {}],
    ['nombre vacio', { name: '   ' }],
    ['nombre de mas de 80 caracteres', { name: 'x'.repeat(81) }],
    ['orden decimal', { name: 'A', displayOrder: 1.5 }],
    ['orden negativo', { name: 'A', displayOrder: -1 }],
    ['orden que no es numero', { name: 'A', displayOrder: 'uno' }],
  ])('%s -> 400 VALIDATION_ERROR', async (_, body) => {
    const res = await call(app.base, 'POST', '/api/catalog/categories', { token: admin(), body });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(categoryRepository.create).not.toHaveBeenCalled();
  });

  it('nombre repetido -> 409 CONFLICT', async () => {
    categoryRepository.create.mockRejectedValue(prismaError('P2002'));
    const res = await call(app.base, 'POST', '/api/catalog/categories', {
      token: admin(),
      body: { name: 'Pizzas' },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });
});

describe('PUT /api/catalog/categories/:id', () => {
  it('actualiza -> 200', async () => {
    categoryRepository.update.mockResolvedValue(
      makeCategory({ name: 'Pizzas XL', displayOrder: 3 }),
    );
    const res = await call(app.base, 'PUT', `/api/catalog/categories/${CATEGORY_ID}`, {
      token: admin(),
      body: { name: 'Pizzas XL', displayOrder: 3 },
    });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Pizzas XL');
    expect(categoryRepository.update).toHaveBeenCalledWith(CATEGORY_ID, {
      name: 'Pizzas XL',
      displayOrder: 3,
    });
  });

  it('id inexistente -> 404 NOT_FOUND', async () => {
    categoryRepository.update.mockRejectedValue(prismaError('P2025'));
    const res = await call(app.base, 'PUT', `/api/catalog/categories/${MISSING_ID}`, {
      token: admin(),
      body: { name: 'X' },
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('nombre de otra categoria -> 409 CONFLICT', async () => {
    categoryRepository.update.mockRejectedValue(prismaError('P2002'));
    const res = await call(app.base, 'PUT', `/api/catalog/categories/${CATEGORY_ID}`, {
      token: admin(),
      body: { name: 'Bebidas' },
    });
    expect(res.status).toBe(409);
  });

  it('id que no es UUID -> 400', async () => {
    const res = await call(app.base, 'PUT', '/api/catalog/categories/abc', {
      token: admin(),
      body: { name: 'X' },
    });
    expect(res.status).toBe(400);
    expect(categoryRepository.update).not.toHaveBeenCalled();
  });
});

describe('POST /api/catalog/products (multipart)', () => {
  beforeEach(() => {
    categoryRepository.findById.mockResolvedValue(makeCategory());
    productRepository.create.mockImplementation(async (data) => makeProduct(data));
  });

  const post = (form) =>
    call(app.base, 'POST', '/api/catalog/products', { token: admin(), body: form });

  it.each([
    ['JPG', JPEG, 'foto.jpg', '.jpg'],
    ['PNG', PNG, 'foto.png', '.png'],
    ['WebP', WEBP, 'foto.webp', '.webp'],
  ])('crea el producto con una foto %s -> 201', async (_, photo, photoName, ext) => {
    const res = await post(productForm({ photo, photoName }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      categoryId: CATEGORY_ID,
      name: 'Pizza Margarita',
      price: 32000,
      isAvailable: true,
    });
    expect(res.body).not.toHaveProperty('createdAt');
    expect(res.body.photoUrl).toMatch(new RegExp(`^/api/catalog/photos/[0-9a-f-]{36}\\${ext}$`));
    expect(uploaded()).toHaveLength(1);
  });

  it('el nombre del archivo lo genera el servidor y se ignora el del cliente', async () => {
    const res = await post(productForm({ photoName: '../../etc/passwd.jpg' }));
    expect(res.status).toBe(201);
    expect(res.body.photoUrl).not.toMatch(/passwd|\.\./);
    expect(uploaded().map((f) => f.name)).toEqual([res.body.photoUrl.split('/').pop()]);
  });

  it('la foto guardada se sirve publicamente (sin token) con su contenido', async () => {
    const created = await post(productForm({ photo: PNG, photoName: 'a.png' }));
    const res = await fetch(app.base + created.body.photoUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it('no se lista el directorio de fotos', async () => {
    await post(productForm());
    const res = await call(app.base, 'GET', '/api/catalog/photos/');
    expect(res.status).toBe(404);
  });

  it('isAvailable=false se respeta y el valor por defecto es true', async () => {
    await post(productForm({ isAvailable: 'false' }));
    expect(productRepository.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ isAvailable: false }),
    );
    await post(productForm());
    expect(productRepository.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ isAvailable: true }),
    );
  });

  it('guarda el precio como entero y una descripcion vacia como null', async () => {
    await post(productForm({ price: '0', description: '' }));
    expect(productRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ price: 0, description: null }),
    );
  });

  it('sin foto -> 400 y no crea nada', async () => {
    const res = await post(productForm({ photo: null }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields[0].path).toBe('photo');
    expect(productRepository.create).not.toHaveBeenCalled();
  });

  it('archivo que no es imagen aunque se llame .jpg y declare image/jpeg -> 400', async () => {
    const res = await post(
      productForm({ photo: Buffer.from('<?php echo 1; ?>'), photoName: 'x.jpg' }),
    );
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields[0].path).toBe('photo');
    expect(productRepository.create).not.toHaveBeenCalled();
    expect(fs.existsSync(process.env.UPLOADS_DIR)).toBe(false);
  });

  it('GIF (formato no permitido) -> 400', async () => {
    const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(10)]);
    const res = await post(productForm({ photo: gif, photoName: 'a.gif' }));
    expect(res.status).toBe(400);
  });

  it('foto de mas de 2 MB -> 400 y no se guarda', async () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(2 * 1024 * 1024)]);
    const res = await post(productForm({ photo: big }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields[0].message).toMatch(/2 MB/);
    expect(productRepository.create).not.toHaveBeenCalled();
    expect(fs.existsSync(process.env.UPLOADS_DIR)).toBe(false);
  });

  it('una foto de exactamente 2 MB si se acepta', async () => {
    const exact = Buffer.concat([JPEG, Buffer.alloc(2 * 1024 * 1024 - JPEG.length)]);
    const res = await post(productForm({ photo: exact }));
    expect(res.status).toBe(201);
  });

  it('un archivo en otro campo distinto de "photo" -> 400', async () => {
    const form = productForm({ photo: null });
    form.append('imagen', new Blob([JPEG]), 'a.jpg');
    const res = await post(form);
    expect(res.status).toBe(400);
  });

  it('dos archivos -> 400', async () => {
    const form = productForm();
    form.append('photo', new Blob([PNG]), 'b.png');
    const res = await post(form);
    expect(res.status).toBe(400);
    expect(productRepository.create).not.toHaveBeenCalled();
  });

  it.each([
    ['sin nombre', { name: undefined }, 'name'],
    ['nombre de mas de 120 caracteres', { name: 'x'.repeat(121) }, 'name'],
    ['sin precio', { price: undefined }, 'price'],
    ['precio decimal', { price: '32000.50' }, 'price'],
    ['precio negativo', { price: '-1' }, 'price'],
    ['precio con texto', { price: '12abc' }, 'price'],
    ['sin categoria', { categoryId: undefined }, 'categoryId'],
    ['categoria que no es UUID', { categoryId: '123' }, 'categoryId'],
    ['isAvailable invalido', { isAvailable: 'quizas' }, 'isAvailable'],
  ])('%s -> 400 sobre el campo %s', async (_, override, field) => {
    const res = await post(productForm(override));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields.map((f) => f.path)).toContain(field);
    expect(productRepository.create).not.toHaveBeenCalled();
    expect(fs.existsSync(process.env.UPLOADS_DIR)).toBe(false);
  });

  it('el cliente no puede fijar la foto ni otros campos por el cuerpo', async () => {
    await post(productForm({ photoUrl: 'http://malo.example/x.jpg', productId: MISSING_ID }));
    const data = productRepository.create.mock.calls[0][0];
    expect(data.photoUrl).toMatch(/^\/api\/catalog\/photos\//);
    expect(data).not.toHaveProperty('productId');
  });

  it('categoria inexistente -> 400 y no se guarda la foto', async () => {
    categoryRepository.findById.mockResolvedValue(null);
    const res = await post(productForm());
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields[0].path).toBe('categoryId');
    expect(fs.existsSync(process.env.UPLOADS_DIR)).toBe(false);
  });

  it('nombre repetido en la categoria -> 409 y se borra la foto ya escrita', async () => {
    productRepository.create.mockRejectedValue(prismaError('P2002'));
    const res = await post(productForm());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(uploaded()).toHaveLength(0);
  });

  it('error inesperado de la base -> 500 y se borra la foto ya escrita', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    productRepository.create.mockRejectedValue(new Error('conexion perdida'));
    const res = await post(productForm());
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(uploaded()).toHaveLength(0);
  });

  it('una peticion JSON (no multipart) -> 400', async () => {
    const res = await call(app.base, 'POST', '/api/catalog/products', {
      token: admin(),
      body: { name: 'X', price: 1, categoryId: CATEGORY_ID },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
