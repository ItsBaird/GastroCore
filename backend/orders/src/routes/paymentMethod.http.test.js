// Metodos de pago (GC-ADM-0001) con la app real (rutas, validacion, autenticacion, errores).
// Solo el repositorio va simulado: no hace falta base de datos.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPaymentMethod,
  findAllPaymentMethods,
  findPaymentMethodById,
  findPaymentMethodByName,
  updatePaymentMethod,
} from '../repositories/paymentMethod.repository.js';
import {
  METHOD_ID,
  MISSING_ID,
  OTHER_METHOD_ID,
  call,
  makePaymentMethod,
  startApp,
  tokenFor,
} from '../test/helpers.js';

// Evita que los repositorios de las demas rutas construyan un PrismaClient real al cargar la app
vi.mock('../config/prisma.js', () => ({ prisma: {} }));
vi.mock('../repositories/paymentMethod.repository.js', () => ({
  createPaymentMethod: vi.fn(),
  findAllPaymentMethods: vi.fn(),
  findPaymentMethodById: vi.fn(),
  findPaymentMethodByName: vi.fn(),
  updatePaymentMethod: vi.fn(),
}));

let app;
const admin = () => tokenFor('ADMIN');
const URL = '/api/orders/payment-methods';
const p2002 = () =>
  Object.assign(new Error('Unique constraint'), { code: 'P2002', meta: { target: ['name'] } });

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  findAllPaymentMethods.mockResolvedValue([]);
  findPaymentMethodByName.mockResolvedValue(null);
  createPaymentMethod.mockImplementation(async (data) => makePaymentMethod(data));
  updatePaymentMethod.mockImplementation(async (_id, data) => makePaymentMethod(data));
  findPaymentMethodById.mockResolvedValue(makePaymentMethod());
});

describe('acceso', () => {
  it.each([
    ['GET', URL],
    ['POST', URL],
    ['PUT', `${URL}/${METHOD_ID}`],
  ])('%s %s sin token -> 401', async (method, path) => {
    const res = await call(app.base, method, path, { body: method === 'GET' ? undefined : {} });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it.each(['WAITER', 'COOK'])(
    'un %s no puede crear ni editar metodos de pago -> 403',
    async (role) => {
      const token = tokenFor(role);
      const create = await call(app.base, 'POST', URL, { token, body: { name: 'Nequi' } });
      const edit = await call(app.base, 'PUT', `${URL}/${METHOD_ID}`, {
        token,
        body: { name: 'Nequi' },
      });
      expect([create.status, edit.status]).toEqual([403, 403]);
      expect(create.body.error.code).toBe('FORBIDDEN');
      expect(createPaymentMethod).not.toHaveBeenCalled();
      expect(updatePaymentMethod).not.toHaveBeenCalled();
    },
  );

  it.each(['ADMIN', 'WAITER', 'COOK'])(
    'un %s autenticado puede listar (el mesero lo necesita al cobrar)',
    async (role) => {
      const res = await call(app.base, 'GET', `${URL}?active=true`, { token: tokenFor(role) });
      expect(res.status).toBe(200);
    },
  );

  it('no existe DELETE: los metodos no se borran, se desactivan', async () => {
    const res = await call(app.base, 'DELETE', `${URL}/${METHOD_ID}`, { token: admin() });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/orders/payment-methods', () => {
  it('no la captura GET /api/orders/:orderId: devuelve la lista, no un 400 de UUID', async () => {
    findAllPaymentMethods.mockResolvedValue([makePaymentMethod()]);
    const res = await call(app.base, 'GET', URL, { token: admin() });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { paymentMethodId: METHOD_ID, name: 'Efectivo', isCash: true, isActive: true },
    ]);
  });

  it('solo expone los campos del contrato (sin createdAt)', async () => {
    findAllPaymentMethods.mockResolvedValue([makePaymentMethod()]);
    const res = await call(app.base, 'GET', URL, { token: admin() });
    expect(Object.keys(res.body[0]).sort()).toEqual([
      'isActive',
      'isCash',
      'name',
      'paymentMethodId',
    ]);
  });

  it('sin filtro devuelve todos (activos e inactivos); sin metodos -> []', async () => {
    const res = await call(app.base, 'GET', URL, { token: admin() });
    expect(res.body).toEqual([]);
    expect(findAllPaymentMethods).toHaveBeenCalledWith({ active: undefined });
  });

  it.each([
    ['true', true],
    ['false', false],
  ])('?active=%s filtra por estado', async (value, expected) => {
    await call(app.base, 'GET', `${URL}?active=${value}`, { token: admin() });
    expect(findAllPaymentMethods).toHaveBeenCalledWith({ active: expected });
  });

  it.each(['?active=', '?active=si', '?active=1', '?active=TRUE'])(
    'filtro invalido %s -> 400',
    async (query) => {
      const res = await call(app.base, 'GET', URL + query, { token: admin() });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(findAllPaymentMethods).not.toHaveBeenCalled();
    },
  );
});

describe('POST /api/orders/payment-methods', () => {
  const post = (body) => call(app.base, 'POST', URL, { token: admin(), body });

  it('crea el metodo con is_cash e is_active segun lo indicado -> 201', async () => {
    const res = await post({ name: 'Nequi', isCash: false, isActive: false });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Nequi', isCash: false, isActive: false });
    expect(createPaymentMethod).toHaveBeenCalledWith({
      name: 'Nequi',
      isCash: false,
      isActive: false,
    });
  });

  it('es efectivo y esta activo si se indica asi', async () => {
    const res = await post({ name: 'Efectivo', isCash: true, isActive: true });
    expect(res.body).toMatchObject({ isCash: true, isActive: true });
  });

  it('por defecto: no es efectivo (isCash=false) y nace activo (isActive=true)', async () => {
    const res = await post({ name: 'Tarjeta' });
    expect(res.status).toBe(201);
    expect(createPaymentMethod).toHaveBeenCalledWith({
      name: 'Tarjeta',
      isCash: false,
      isActive: true,
    });
  });

  it('recorta los espacios del nombre', async () => {
    await post({ name: '  Datafono  ' });
    expect(createPaymentMethod.mock.calls[0][0].name).toBe('Datafono');
  });

  it('acepta un nombre de exactamente 50 caracteres', async () => {
    expect((await post({ name: 'x'.repeat(50) })).status).toBe(201);
  });

  it('nombre duplicado -> 409 CONFLICT sobre name y no crea nada', async () => {
    findPaymentMethodByName.mockResolvedValue(makePaymentMethod());
    const res = await post({ name: 'Efectivo' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.details).toEqual({ field: 'name' });
    expect(createPaymentMethod).not.toHaveBeenCalled();
  });

  it('el duplicado se detecta sin distinguir mayusculas ("efectivo" ya existe como "Efectivo")', async () => {
    findPaymentMethodByName.mockResolvedValue(makePaymentMethod({ name: 'Efectivo' }));
    const res = await post({ name: 'efectivo' });
    expect(res.status).toBe(409);
    expect(findPaymentMethodByName).toHaveBeenCalledWith('efectivo');
  });

  it('dos peticiones simultaneas con el mismo nombre: la restriccion unica de la base tambien da 409', async () => {
    createPaymentMethod.mockRejectedValue(p2002());
    const res = await post({ name: 'Nequi' });
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ field: 'name' });
  });

  it.each([
    ['sin nombre', {}],
    ['nombre vacio', { name: '' }],
    ['nombre solo espacios', { name: '    ' }],
    ['nombre de 51 caracteres', { name: 'x'.repeat(51) }],
    ['nombre que no es texto', { name: 123 }],
    ['isCash como texto', { name: 'A', isCash: 'si' }],
    ['isActive como numero', { name: 'A', isActive: 1 }],
    ['isCash null', { name: 'A', isCash: null }],
    ['campos desconocidos', { name: 'A', color: 'rojo' }],
    ['intentar fijar el id', { name: 'A', paymentMethodId: METHOD_ID }],
  ])('rechaza %s -> 400', async (_name, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(createPaymentMethod).not.toHaveBeenCalled();
  });

  it('JSON mal formado -> 400', async () => {
    const res = await call(app.base, 'POST', URL, { token: admin(), rawBody: '{x' });
    expect(res.status).toBe(400);
  });

  it('error inesperado de la base -> 500 sin filtrar detalles', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    createPaymentMethod.mockRejectedValue(new Error('password=secreto'));
    const res = await post({ name: 'Nequi' });
    expect(res.status).toBe(500);
    expect(res.text).not.toContain('secreto');
    spy.mockRestore();
  });
});

describe('PUT /api/orders/payment-methods/:id', () => {
  const put = (body, id = METHOD_ID) =>
    call(app.base, 'PUT', `${URL}/${id}`, { token: admin(), body });

  it('desactivar: is_active=false; el metodo se conserva (no se borra nada) -> 200', async () => {
    const res = await put({ name: 'Efectivo', isActive: false });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ paymentMethodId: METHOD_ID, isActive: false });
    expect(updatePaymentMethod).toHaveBeenCalledWith(METHOD_ID, {
      name: 'Efectivo',
      isActive: false,
    });
  });

  it('lo que no se envia queda como esta: no reinicia isCash ni isActive a los valores por defecto', async () => {
    await put({ name: 'Efectivo caja' });
    expect(updatePaymentMethod).toHaveBeenCalledWith(METHOD_ID, { name: 'Efectivo caja' });
  });

  it('reactivar y cambiar isCash', async () => {
    findPaymentMethodById.mockResolvedValue(makePaymentMethod({ isActive: false }));
    await put({ name: 'Efectivo', isCash: false, isActive: true });
    expect(updatePaymentMethod).toHaveBeenCalledWith(METHOD_ID, {
      name: 'Efectivo',
      isCash: false,
      isActive: true,
    });
  });

  it('un metodo desactivado deja de salir en ?active=true pero sigue en la lista completa', async () => {
    findAllPaymentMethods.mockImplementation(async ({ active } = {}) =>
      [makePaymentMethod({ isActive: false })].filter(
        (m) => active === undefined || m.isActive === active,
      ),
    );
    expect((await call(app.base, 'GET', `${URL}?active=true`, { token: admin() })).body).toEqual(
      [],
    );
    expect((await call(app.base, 'GET', URL, { token: admin() })).body).toHaveLength(1);
  });

  it('cambiar solo mayusculas del propio nombre ("efectivo" -> "Efectivo") no cuenta como duplicado', async () => {
    findPaymentMethodByName.mockResolvedValue(makePaymentMethod({ name: 'efectivo' })); // es el mismo METHOD_ID
    expect((await put({ name: 'Efectivo' })).status).toBe(200);
  });

  it('renombrar al nombre de OTRO metodo -> 409 CONFLICT', async () => {
    findPaymentMethodByName.mockResolvedValue(
      makePaymentMethod({ paymentMethodId: OTHER_METHOD_ID, name: 'Nequi' }),
    );
    const res = await put({ name: 'Nequi' });
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ field: 'name' });
    expect(updatePaymentMethod).not.toHaveBeenCalled();
  });

  it('carrera con otra edicion (P2002 de la base) -> 409', async () => {
    updatePaymentMethod.mockRejectedValue(p2002());
    expect((await put({ name: 'Nequi' })).status).toBe(409);
  });

  it('metodo inexistente -> 404 NOT_FOUND', async () => {
    findPaymentMethodById.mockResolvedValue(null);
    const res = await put({ name: 'X' }, MISSING_ID);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(updatePaymentMethod).not.toHaveBeenCalled();
  });

  it.each([
    ['id que no es UUID', 'no-uuid', { name: 'X' }],
    ['sin nombre', METHOD_ID, { isActive: false }],
    ['nombre vacio', METHOD_ID, { name: '  ' }],
    ['isActive como texto', METHOD_ID, { name: 'X', isActive: 'false' }],
    ['campos desconocidos', METHOD_ID, { name: 'X', paymentMethodId: OTHER_METHOD_ID }],
  ])('rechaza %s -> 400', async (_name, id, body) => {
    const res = await put(body, id);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(updatePaymentMethod).not.toHaveBeenCalled();
  });
});
