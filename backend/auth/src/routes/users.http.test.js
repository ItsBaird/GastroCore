// Endpoints de usuarios con la app real (rutas, validación, autenticación, errores).
// Solo los repositorios van simulados: no hace falta base de datos.
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { userRepository } from '../repositories/user.repository.js';
import {
  ADMIN_ID,
  MISSING_ID,
  USER_ID,
  call,
  makeUser,
  startApp,
  tokenFor,
} from '../test/helpers.js';

vi.mock('../repositories/user.repository.js', () => ({
  userRepository: { create: vi.fn(), findAll: vi.fn(), findById: vi.fn(), update: vi.fn() },
}));
vi.mock('../repositories/refreshToken.repository.js', () => ({ refreshTokenRepository: {} }));

let app;
const admin = () => tokenFor('ADMIN');

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => vi.resetAllMocks());

const newUser = { email: 'cocinero@lapizzeta.com', password: 'ClaveTemporal12', role: 'COOK' };

describe('acceso: solo un ADMIN autenticado administra cuentas', () => {
  const rutas = [
    ['POST', '/api/auth/register', newUser],
    ['GET', '/api/auth/users'],
    ['GET', `/api/auth/users/${USER_ID}`],
    ['PUT', `/api/auth/users/${USER_ID}`, { role: 'COOK' }],
    ['DELETE', `/api/auth/users/${USER_ID}`],
  ];

  it.each(rutas)('%s %s sin token -> 401 UNAUTHENTICATED', async (method, path, body) => {
    const res = await call(app.base, method, path, { body });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it.each(rutas)('%s %s con token de WAITER -> 403 FORBIDDEN', async (method, path, body) => {
    const res = await call(app.base, method, path, { body, token: tokenFor('WAITER') });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it.each(rutas)('%s %s con token de COOK -> 403 FORBIDDEN', async (method, path, body) => {
    const res = await call(app.base, method, path, { body, token: tokenFor('COOK') });
    expect(res.status).toBe(403);
  });

  it('un acceso denegado no toca la base de datos', async () => {
    await call(app.base, 'POST', '/api/auth/register', {
      body: newUser,
      token: tokenFor('WAITER'),
    });
    expect(userRepository.create).not.toHaveBeenCalled();
  });

  it('se valida el permiso ANTES que el cuerpo: sin sesión no se filtra qué campos son inválidos', async () => {
    const res = await call(app.base, 'POST', '/api/auth/register', { body: {} });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/register', () => {
  it('criterio 1: crea la cuenta y responde 201 con el usuario (userId UUID)', async () => {
    userRepository.create.mockImplementation(async (data) => makeUser({ ...data }));

    const res = await call(app.base, 'POST', '/api/auth/register', {
      body: newUser,
      token: admin(),
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      email: 'cocinero@lapizzeta.com',
      role: 'COOK',
      isActive: true,
    });
    expect(res.body.userId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('no devuelve la contraseña ni su hash, y la guarda con argon2id', async () => {
    userRepository.create.mockImplementation(async (data) => makeUser({ ...data }));

    const res = await call(app.base, 'POST', '/api/auth/register', {
      body: newUser,
      token: admin(),
    });

    expect(res.text).not.toMatch(/password|argon2/i);
    const saved = userRepository.create.mock.calls[0][0];
    expect(saved.passwordHash).toMatch(/^\$argon2id\$/);
    expect(saved).not.toHaveProperty('password');
  });

  it('normaliza el email antes de guardarlo', async () => {
    userRepository.create.mockImplementation(async (data) => makeUser({ ...data }));

    await call(app.base, 'POST', '/api/auth/register', {
      body: { ...newUser, email: '  Cocinero@LaPizzeta.com ' },
      token: admin(),
    });

    expect(userRepository.create.mock.calls[0][0].email).toBe('cocinero@lapizzeta.com');
  });

  it('criterio 2: email repetido -> 409 EMAIL_ALREADY_EXISTS', async () => {
    userRepository.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '6.19.3' }),
    );

    const res = await call(app.base, 'POST', '/api/auth/register', {
      body: newUser,
      token: admin(),
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'EMAIL_ALREADY_EXISTS',
      message: 'El email ya esta registrado',
    });
  });

  it('criterio 3: contraseña corta y rol inválido -> 400 VALIDATION_ERROR con los campos', async () => {
    const res = await call(app.base, 'POST', '/api/auth/register', {
      body: { email: 'x@y.com', password: 'corta', role: 'JEFE' },
      token: admin(),
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields.map((f) => f.path).sort()).toEqual(['password', 'role']);
    expect(userRepository.create).not.toHaveBeenCalled();
  });

  it('un cuerpo con JSON mal formado -> 400 VALIDATION_ERROR', async () => {
    const res = await call(app.base, 'POST', '/api/auth/register', {
      body: '{no es json',
      token: admin(),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('un error inesperado de la base responde 500 sin exponer el detalle interno', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    userRepository.create.mockRejectedValue(
      new Error('password authentication failed for user "auth_user"'),
    );

    const res = await call(app.base, 'POST', '/api/auth/register', {
      body: newUser,
      token: admin(),
    });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Error interno del servidor',
    });
    expect(res.text).not.toContain('auth_user');
  });
});

describe('GET /api/auth/users y /api/auth/users/:id', () => {
  it('lista los usuarios sin datos sensibles', async () => {
    userRepository.findAll.mockResolvedValue([
      makeUser(),
      makeUser({ userId: ADMIN_ID, role: 'ADMIN' }),
    ]);

    const res = await call(app.base, 'GET', '/api/auth/users', { token: admin() });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.text).not.toMatch(/passwordHash|failedLoginAttempts|lockedUntil|argon2/);
  });

  it('devuelve un usuario por id', async () => {
    userRepository.findById.mockResolvedValue(makeUser());

    const res = await call(app.base, 'GET', `/api/auth/users/${USER_ID}`, { token: admin() });

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(USER_ID);
  });

  it('id inexistente -> 404 NOT_FOUND', async () => {
    userRepository.findById.mockResolvedValue(null);
    const res = await call(app.base, 'GET', `/api/auth/users/${MISSING_ID}`, { token: admin() });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('id que no es UUID -> 400 VALIDATION_ERROR sin consultar la base', async () => {
    const res = await call(app.base, 'GET', '/api/auth/users/abc', { token: admin() });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields[0].path).toBe('id');
    expect(userRepository.findById).not.toHaveBeenCalled();
  });
});

describe('PUT /api/auth/users/:id', () => {
  beforeEach(() => {
    userRepository.findById.mockResolvedValue(makeUser());
    userRepository.update.mockImplementation(async (id, data) => makeUser({ ...data }));
  });

  it('cambia el rol y responde con el usuario actualizado', async () => {
    const res = await call(app.base, 'PUT', `/api/auth/users/${USER_ID}`, {
      body: { role: 'COOK' },
      token: admin(),
    });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('COOK');
  });

  it('desactivar revoca las sesiones; reactivar limpia el bloqueo', async () => {
    await call(app.base, 'PUT', `/api/auth/users/${USER_ID}`, {
      body: { isActive: false },
      token: admin(),
    });
    expect(userRepository.update.mock.calls[0][2]).toEqual({ revokeSessions: true });

    await call(app.base, 'PUT', `/api/auth/users/${USER_ID}`, {
      body: { isActive: true },
      token: admin(),
    });
    expect(userRepository.update.mock.calls[1][1]).toMatchObject({
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
  });

  it('ignora email y contraseña: no se editan aquí', async () => {
    await call(app.base, 'PUT', `/api/auth/users/${USER_ID}`, {
      body: { role: 'COOK', email: 'otro@x.com', password: 'otra-clave-123' },
      token: admin(),
    });

    expect(userRepository.update.mock.calls[0][1]).toEqual({ role: 'COOK' });
  });

  it.each([
    ['cuerpo vacío', {}],
    ['rol inválido', { role: 'JEFE' }],
    ['isActive no booleano', { isActive: 'false' }],
  ])('%s -> 400 VALIDATION_ERROR', async (_t, body) => {
    const res = await call(app.base, 'PUT', `/api/auth/users/${USER_ID}`, { body, token: admin() });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(userRepository.update).not.toHaveBeenCalled();
  });

  it('usuario inexistente -> 404', async () => {
    userRepository.findById.mockResolvedValue(null);
    const res = await call(app.base, 'PUT', `/api/auth/users/${MISSING_ID}`, {
      body: { role: 'COOK' },
      token: admin(),
    });
    expect(res.status).toBe(404);
  });

  it.each([{ role: 'WAITER' }, { isActive: false }])(
    'el ADMIN no puede %o sobre sí mismo -> 403 FORBIDDEN',
    async (body) => {
      const res = await call(app.base, 'PUT', `/api/auth/users/${ADMIN_ID}`, {
        body,
        token: admin(),
      });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(userRepository.update).not.toHaveBeenCalled();
    },
  );
});

describe('DELETE /api/auth/users/:id', () => {
  beforeEach(() => {
    userRepository.findById.mockResolvedValue(makeUser());
    userRepository.update.mockImplementation(async (id, data) => makeUser({ ...data }));
  });

  it('desactiva (no borra): 204 sin cuerpo y revoca sus sesiones', async () => {
    const res = await call(app.base, 'DELETE', `/api/auth/users/${USER_ID}`, { token: admin() });

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(userRepository.update).toHaveBeenCalledWith(
      USER_ID,
      { isActive: false },
      { revokeSessions: true },
    );
  });

  it('el ADMIN no puede desactivarse a sí mismo -> 403', async () => {
    const res = await call(app.base, 'DELETE', `/api/auth/users/${ADMIN_ID}`, { token: admin() });
    expect(res.status).toBe(403);
    expect(userRepository.update).not.toHaveBeenCalled();
  });

  it('usuario inexistente -> 404', async () => {
    userRepository.findById.mockResolvedValue(null);
    const res = await call(app.base, 'DELETE', `/api/auth/users/${MISSING_ID}`, { token: admin() });
    expect(res.status).toBe(404);
  });
});
