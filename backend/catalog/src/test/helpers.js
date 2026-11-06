import jwt from 'jsonwebtoken';

export const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
export const CATEGORY_ID = '33333333-3333-4333-8333-333333333333';
export const PRODUCT_ID = '44444444-4444-4444-8444-444444444444';
export const MISSING_ID = '00000000-0000-4000-8000-000000000000';

// Access token RS256 como el que emite Auth (la clave publica del entorno de pruebas lo valida)
export const tokenFor = (role = 'ADMIN', { userId = ADMIN_ID, permissions = [] } = {}) =>
  jwt.sign({ role, permissions }, process.env.TEST_JWT_PRIVATE_KEY, {
    algorithm: 'RS256',
    subject: userId,
    expiresIn: 900,
  });

// Cabeceras minimas de cada formato de imagen (lo unico que mira la validacion de firma)
export const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
export const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
export const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);

export function makeCategory(overrides = {}) {
  return {
    categoryId: CATEGORY_ID,
    name: 'Pizzas',
    displayOrder: 1,
    createdAt: new Date('2026-10-01T10:00:00Z'),
    ...overrides,
  };
}

export function makeProduct(overrides = {}) {
  return {
    productId: PRODUCT_ID,
    categoryId: CATEGORY_ID,
    name: 'Pizza Margarita',
    description: 'Tomate, mozzarella y albahaca',
    price: 32000,
    photoUrl: '/api/catalog/photos/x.jpg',
    isAvailable: true,
    createdAt: new Date('2026-10-01T10:00:00Z'),
    updatedAt: new Date('2026-10-01T10:00:00Z'),
    ...overrides,
  };
}

// Levanta la app real (middlewares, rutas, errores) en un puerto libre; los repositorios van simulados
export async function startApp() {
  const { default: app } = await import('../app.js');
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// `body` puede ser un objeto (JSON) o un FormData (multipart)
export async function call(base, method, path, { token, body } = {}) {
  const isForm = body instanceof FormData;
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined && !isForm && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // respuesta sin cuerpo JSON
  }
  return { status: res.status, body: json, text, headers: res.headers };
}

export function productForm({ photo = JPEG, photoName = 'foto.jpg', ...fields } = {}) {
  const data = {
    name: 'Pizza Margarita',
    description: 'Tomate, mozzarella y albahaca',
    price: '32000',
    categoryId: CATEGORY_ID,
    ...fields,
  };
  const form = new FormData();
  for (const [k, v] of Object.entries(data)) if (v !== undefined) form.append(k, v);
  if (photo) form.append('photo', new Blob([photo]), photoName);
  return form;
}
