// Login, refresh y logout con la app real (cookies, cabeceras, errores).
// Solo los repositorios van simulados: no hace falta base de datos.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshTokenRepository } from '../repositories/refreshToken.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { hashToken } from '../services/token.service.js';
import { PASSWORD, USER_ID, call, makeUser, passwordHash, startApp } from '../test/helpers.js';

vi.mock('../repositories/user.repository.js', () => ({
  userRepository: {
    findByEmailWithPermissions: vi.fn(),
    findByIdWithPermissions: vi.fn(),
    findAll: vi.fn(),
    incrementFailedAttempts: vi.fn(),
    lockUntil: vi.fn(),
    resetLoginState: vi.fn(),
  },
}));
vi.mock('../repositories/refreshToken.repository.js', () => ({
  refreshTokenRepository: {
    create: vi.fn(),
    findByHash: vi.fn(),
    rotate: vi.fn(),
    revokeByHash: vi.fn(),
    revokeAllForUser: vi.fn(),
  },
}));

const days = (n) => n * 24 * 60 * 60 * 1000;
const credentials = { email: 'mesero@lapizzeta.com', password: PASSWORD };
const refreshCookie = (res) => res.cookies.find((c) => c.startsWith('refreshToken='));
const cookieValue = (res) => refreshCookie(res).split(';')[0].split('=')[1];
const expiresOf = (cookie) => new Date(/Expires=([^;]+)/i.exec(cookie)[1]);

let app;
let user;

beforeAll(async () => {
  user = makeUser({ passwordHash: await passwordHash() });
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  userRepository.findByEmailWithPermissions.mockResolvedValue(user);
  userRepository.incrementFailedAttempts.mockResolvedValue({ failedLoginAttempts: 1 });
});

describe('POST /api/auth/login', () => {
  it('criterio 1: 200 con el access token y el usuario; el refresh token solo va en cookie', async () => {
    const res = await call(app.base, 'POST', '/api/auth/login', { body: credentials });

    expect(res.status).toBe(200);
    expect(res.body.accessToken.split('.')).toHaveLength(3);
    expect(res.body.user).toEqual({
      userId: USER_ID,
      email: 'mesero@lapizzeta.com',
      role: 'WAITER',
      permissions: [],
    });
    expect(Object.keys(res.body).sort()).toEqual(['accessToken', 'user']);
    expect(res.text).not.toContain(cookieValue(res));
  });

  it('la cookie del refresh token es HttpOnly; Secure; SameSite=Strict; Path=/api/auth y dura 7 días', async () => {
    const res = await call(app.base, 'POST', '/api/auth/login', { body: credentials });

    const cookie = refreshCookie(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/;\s*Secure/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/auth(;|$)/i);
    expect(Math.abs(expiresOf(cookie).getTime() - (Date.now() + days(7)))).toBeLessThan(10_000);
  });

  it('la cookie lleva el mismo token cuyo hash se guardó en la base', async () => {
    const res = await call(app.base, 'POST', '/api/auth/login', { body: credentials });
    expect(refreshTokenRepository.create.mock.calls[0][0].tokenHash).toBe(
      hashToken(cookieValue(res)),
    );
  });

  it('la respuesta no se guarda en caché (Cache-Control: no-store)', async () => {
    const res = await call(app.base, 'POST', '/api/auth/login', { body: credentials });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('normaliza el email (mayúsculas y espacios) antes de buscar al usuario', async () => {
    await call(app.base, 'POST', '/api/auth/login', {
      body: { email: '  Mesero@LaPizzeta.COM ', password: PASSWORD },
    });
    expect(userRepository.findByEmailWithPermissions).toHaveBeenCalledWith('mesero@lapizzeta.com');
  });

  it('el token del login abre una ruta protegida (el access token y el middleware son compatibles)', async () => {
    const admin = makeUser({ role: 'ADMIN', passwordHash: user.passwordHash });
    userRepository.findByEmailWithPermissions.mockResolvedValue(admin);
    userRepository.findAll.mockResolvedValue([admin]);

    const login = await call(app.base, 'POST', '/api/auth/login', { body: credentials });
    const res = await call(app.base, 'GET', '/api/auth/users', { token: login.body.accessToken });

    expect(res.status).toBe(200);
  });

  describe('criterio 2: credenciales incorrectas', () => {
    it('contraseña incorrecta -> 401 UNAUTHENTICATED, sin cookie ni token', async () => {
      const res = await call(app.base, 'POST', '/api/auth/login', {
        body: { ...credentials, password: 'incorrecta-123' },
      });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect(res.cookies).toEqual([]);
      expect(res.body).not.toHaveProperty('accessToken');
    });

    it('email inexistente y contraseña incorrecta devuelven EXACTAMENTE la misma respuesta', async () => {
      const mala = await call(app.base, 'POST', '/api/auth/login', {
        body: { ...credentials, password: 'incorrecta-123' },
      });
      userRepository.findByEmailWithPermissions.mockResolvedValue(null);
      const sinUsuario = await call(app.base, 'POST', '/api/auth/login', {
        body: { email: 'nadie@lapizzeta.com', password: 'incorrecta-123' },
      });

      expect(sinUsuario.status).toBe(mala.status);
      expect(sinUsuario.body).toEqual(mala.body);
    });

    it('el intento fallido se cuenta', async () => {
      await call(app.base, 'POST', '/api/auth/login', {
        body: { ...credentials, password: 'incorrecta-123' },
      });
      expect(userRepository.incrementFailedAttempts).toHaveBeenCalledWith(USER_ID);
    });

    it('una cuenta desactivada recibe el mismo 401 genérico', async () => {
      userRepository.findByEmailWithPermissions.mockResolvedValue({ ...user, isActive: false });
      const res = await call(app.base, 'POST', '/api/auth/login', { body: credentials });
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Credenciales invalidas');
    });
  });

  describe('criterio 3: cuenta bloqueada', () => {
    it('423 ACCOUNT_LOCKED con la hora de fin, aunque la contraseña sea correcta', async () => {
      const lockedUntil = new Date(Date.now() + 10 * 60 * 1000);
      userRepository.findByEmailWithPermissions.mockResolvedValue({ ...user, lockedUntil });

      const res = await call(app.base, 'POST', '/api/auth/login', { body: credentials });

      expect(res.status).toBe(423);
      expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
      expect(res.body.error.details.lockedUntil).toBe(lockedUntil.toISOString());
      expect(res.cookies).toEqual([]);
    });

    it('el 5.º intento fallido deja la cuenta bloqueada', async () => {
      userRepository.incrementFailedAttempts.mockResolvedValue({ failedLoginAttempts: 5 });

      const res = await call(app.base, 'POST', '/api/auth/login', {
        body: { ...credentials, password: 'incorrecta-123' },
      });

      expect(res.status).toBe(401); // este intento todavía responde 401; los siguientes, 423
      expect(userRepository.lockUntil).toHaveBeenCalledTimes(1);
    });
  });

  describe('datos inválidos', () => {
    it('cuerpo vacío -> 400 VALIDATION_ERROR con email y password', async () => {
      const res = await call(app.base, 'POST', '/api/auth/login', { body: {} });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.fields.map((f) => f.path).sort()).toEqual([
        'email',
        'password',
      ]);
      expect(userRepository.findByEmailWithPermissions).not.toHaveBeenCalled();
    });

    it('email mal formado -> 400', async () => {
      const res = await call(app.base, 'POST', '/api/auth/login', {
        body: { email: 'no-es-email', password: 'x' },
      });
      expect(res.status).toBe(400);
    });
  });
});

describe('POST /api/auth/refresh (criterio 4: rotación)', () => {
  const stored = () => ({
    refreshTokenId: 'rt-1',
    userId: USER_ID,
    revokedAt: null,
    replacedBy: null,
    expiresAt: new Date(Date.now() + days(3)),
  });

  beforeEach(() => {
    refreshTokenRepository.findByHash.mockResolvedValue(stored());
    userRepository.findByIdWithPermissions.mockResolvedValue(user);
    refreshTokenRepository.rotate.mockResolvedValue({ refreshTokenId: 'rt-2' });
  });

  it('con la cookie válida: 200, access token nuevo y cookie nueva distinta', async () => {
    const res = await call(app.base, 'POST', '/api/auth/refresh', { cookie: 'token-viejo' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.role).toBe('WAITER');
    expect(cookieValue(res)).not.toBe('token-viejo');
    expect(refreshCookie(res)).toMatch(/HttpOnly.*Secure.*SameSite=Strict|Secure.*HttpOnly/is);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('el token anterior se invalida: se rota en la base y se busca por su hash', async () => {
    await call(app.base, 'POST', '/api/auth/refresh', { cookie: 'token-viejo' });

    expect(refreshTokenRepository.findByHash).toHaveBeenCalledWith(hashToken('token-viejo'));
    expect(refreshTokenRepository.rotate).toHaveBeenCalledWith(
      'rt-1',
      expect.objectContaining({ userId: USER_ID }),
    );
  });

  it('sin cookie -> 401 UNAUTHENTICATED y se limpia la cookie', async () => {
    const res = await call(app.base, 'POST', '/api/auth/refresh');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(refreshCookie(res)).toMatch(/^refreshToken=;/);
    expect(refreshCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('un refresh token ya rotado -> 401, se limpia la cookie y se cierran todas las sesiones', async () => {
    refreshTokenRepository.findByHash.mockResolvedValue({
      ...stored(),
      revokedAt: new Date(),
      replacedBy: 'rt-2',
    });

    const res = await call(app.base, 'POST', '/api/auth/refresh', { cookie: 'ya-usado' });

    expect(res.status).toBe(401);
    expect(refreshCookie(res)).toMatch(/^refreshToken=;/);
    expect(refreshTokenRepository.revokeAllForUser).toHaveBeenCalledWith(USER_ID);
  });

  it('token vencido -> 401', async () => {
    refreshTokenRepository.findByHash.mockResolvedValue({
      ...stored(),
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await call(app.base, 'POST', '/api/auth/refresh', { cookie: 'vencido' });
    expect(res.status).toBe(401);
  });

  it('el refresh token no se acepta por el cuerpo ni por una cabecera Authorization: solo por la cookie', async () => {
    const res = await call(app.base, 'POST', '/api/auth/refresh', {
      body: { refreshToken: 'token-viejo' },
    });
    expect(res.status).toBe(401);
    expect(refreshTokenRepository.findByHash).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/logout', () => {
  it('204 sin cuerpo, revoca el refresh token y limpia la cookie', async () => {
    const res = await call(app.base, 'POST', '/api/auth/logout', { cookie: 'token-vigente' });

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(refreshTokenRepository.revokeByHash).toHaveBeenCalledWith(hashToken('token-vigente'));
    expect(refreshCookie(res)).toMatch(/^refreshToken=;/);
    expect(refreshCookie(res)).toMatch(/Path=\/api\/auth/);
  });

  it('no necesita access token (puede estar vencido justo al cerrar sesión)', async () => {
    const res = await call(app.base, 'POST', '/api/auth/logout', { cookie: 'token-vigente' });
    expect(res.status).toBe(204);
  });

  it('es idempotente: sin cookie responde 204 igual y no toca la base', async () => {
    const res = await call(app.base, 'POST', '/api/auth/logout');

    expect(res.status).toBe(204);
    expect(refreshTokenRepository.revokeByHash).not.toHaveBeenCalled();
  });

  it('solo cierra esa sesión, no las demás del usuario', async () => {
    await call(app.base, 'POST', '/api/auth/logout', { cookie: 'token-vigente' });
    expect(refreshTokenRepository.revokeAllForUser).not.toHaveBeenCalled();
  });
});
