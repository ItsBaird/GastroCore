import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors/AppError.js';
import { refreshTokenRepository } from '../repositories/refreshToken.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { PASSWORD, USER_ID, makeUser, passwordHash, publicKeyPem } from '../test/helpers.js';
import { login, logout, refresh } from './auth.service.js';
import { hashToken } from './token.service.js';

vi.mock('../repositories/user.repository.js', () => ({
  userRepository: {
    findByEmailWithPermissions: vi.fn(),
    findByIdWithPermissions: vi.fn(),
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

const minutes = (n) => n * 60 * 1000;
const days = (n) => n * 24 * 60 * 60 * 1000;
const credentials = { email: 'mesero@lapizzeta.com', password: PASSWORD };

let verifySpy;
let user;

async function rejection(promise) {
  const err = await promise.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return err;
}

beforeAll(async () => {
  user = makeUser({ passwordHash: await passwordHash() });
});

beforeEach(() => {
  vi.resetAllMocks();
  verifySpy = vi.spyOn(argon2, 'verify');
  userRepository.findByEmailWithPermissions.mockResolvedValue(user);
  userRepository.incrementFailedAttempts.mockResolvedValue({ failedLoginAttempts: 1 });
});
afterEach(() => verifySpy.mockRestore());

describe('login: criterio 1 (credenciales correctas y cuenta activa)', () => {
  it('emite un access token RS256 con sub, rol y permisos del usuario', async () => {
    userRepository.findByEmailWithPermissions.mockResolvedValue({
      ...user,
      role: 'COOK',
      permissions: [
        { permission: { code: 'discount:apply' } },
        { permission: { code: 'report:view' } },
      ],
    });

    const session = await login(credentials);

    const payload = jwt.verify(session.accessToken, publicKeyPem(), { algorithms: ['RS256'] });
    expect(payload).toMatchObject({
      sub: USER_ID,
      role: 'COOK',
      permissions: ['discount:apply', 'report:view'],
    });
    expect(payload.exp - payload.iat).toBe(900);
  });

  it('devuelve el usuario con su rol (para mostrar la interfaz del rol) y sin datos sensibles', async () => {
    const session = await login(credentials);

    expect(session.user).toEqual({
      userId: USER_ID,
      email: 'mesero@lapizzeta.com',
      role: 'WAITER',
      permissions: [],
    });
    expect(JSON.stringify(session)).not.toMatch(/passwordHash|argon2/);
  });

  it('emite un refresh token opaco de 7 días y guarda solo su hash', async () => {
    const session = await login(credentials);

    expect(session.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Math.abs(session.refreshExpiresAt.getTime() - (Date.now() + days(7)))).toBeLessThan(
      5000,
    );
    expect(refreshTokenRepository.create).toHaveBeenCalledTimes(1);
    const saved = refreshTokenRepository.create.mock.calls[0][0];
    expect(saved).toEqual({
      userId: USER_ID,
      tokenHash: hashToken(session.refreshToken),
      expiresAt: session.refreshExpiresAt,
    });
    expect(JSON.stringify(saved)).not.toContain(session.refreshToken);
  });

  it('cada login emite un refresh token distinto', async () => {
    const a = await login(credentials);
    const b = await login(credentials);
    expect(a.refreshToken).not.toBe(b.refreshToken);
  });

  it('un login sin fallos previos no escribe en la base de usuarios', async () => {
    await login(credentials);
    expect(userRepository.resetLoginState).not.toHaveBeenCalled();
    expect(userRepository.incrementFailedAttempts).not.toHaveBeenCalled();
  });

  it('un login correcto reinicia el contador de intentos fallidos', async () => {
    userRepository.findByEmailWithPermissions.mockResolvedValue({
      ...user,
      failedLoginAttempts: 3,
    });

    await login(credentials);

    expect(userRepository.resetLoginState).toHaveBeenCalledWith(USER_ID);
  });
});

describe('login: criterio 2 (credenciales incorrectas -> 401 UNAUTHENTICATED sin revelar cuál dato falla)', () => {
  it('contraseña incorrecta -> 401 UNAUTHENTICATED y no emite tokens', async () => {
    const err = await rejection(login({ ...credentials, password: 'incorrecta-123' }));

    expect({ status: err.status, code: err.code }).toEqual({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    expect(refreshTokenRepository.create).not.toHaveBeenCalled();
  });

  it('contraseña incorrecta incrementa el contador de intentos fallidos', async () => {
    await rejection(login({ ...credentials, password: 'incorrecta-123' }));
    expect(userRepository.incrementFailedAttempts).toHaveBeenCalledWith(USER_ID);
  });

  it('email inexistente da EXACTAMENTE el mismo error que contraseña incorrecta', async () => {
    userRepository.findByEmailWithPermissions.mockResolvedValue(null);
    const sinEmail = await rejection(login({ email: 'nadie@x.com', password: 'x' }));
    userRepository.findByEmailWithPermissions.mockResolvedValue(user);
    const sinPassword = await rejection(login({ ...credentials, password: 'incorrecta-123' }));

    expect({
      s: sinEmail.status,
      c: sinEmail.code,
      m: sinEmail.message,
      d: sinEmail.details,
    }).toEqual({
      s: sinPassword.status,
      c: sinPassword.code,
      m: sinPassword.message,
      d: sinPassword.details,
    });
    expect(sinEmail.message).toBe('Credenciales invalidas');
  });

  it('email inexistente: no escribe en la base y no emite nada', async () => {
    userRepository.findByEmailWithPermissions.mockResolvedValue(null);

    await rejection(login({ email: 'nadie@x.com', password: 'x' }));

    expect(userRepository.incrementFailedAttempts).not.toHaveBeenCalled();
    expect(refreshTokenRepository.create).not.toHaveBeenCalled();
  });

  it('con email inexistente verifica igual contra un hash de relleno (misma duración, no revela si existe)', async () => {
    userRepository.findByEmailWithPermissions.mockResolvedValue(null);

    await rejection(login({ email: 'nadie@x.com', password: 'x' }));

    expect(verifySpy).toHaveBeenCalledTimes(1);
    expect(verifySpy.mock.calls[0][0]).toMatch(/^\$argon2id\$/);
  });

  it('cuenta desactivada con contraseña correcta -> mismo 401 genérico', async () => {
    userRepository.findByEmailWithPermissions.mockResolvedValue({ ...user, isActive: false });

    const err = await rejection(login(credentials));

    expect({ status: err.status, code: err.code, message: err.message }).toEqual({
      status: 401,
      code: 'UNAUTHENTICATED',
      message: 'Credenciales invalidas',
    });
    expect(refreshTokenRepository.create).not.toHaveBeenCalled();
  });

  it('una cuenta desactivada con la contraseña correcta no suma intentos fallidos', async () => {
    userRepository.findByEmailWithPermissions.mockResolvedValue({ ...user, isActive: false });
    await rejection(login(credentials));
    expect(userRepository.incrementFailedAttempts).not.toHaveBeenCalled();
  });
});

describe('login: criterio 3 (bloqueo tras 5 intentos fallidos)', () => {
  it('el 5.º fallo bloquea la cuenta 15 minutos', async () => {
    userRepository.incrementFailedAttempts.mockResolvedValue({ failedLoginAttempts: 5 });

    await rejection(login({ ...credentials, password: 'incorrecta-123' }));

    expect(userRepository.lockUntil).toHaveBeenCalledTimes(1);
    const [id, lockedUntil] = userRepository.lockUntil.mock.calls[0];
    expect(id).toBe(USER_ID);
    expect(Math.abs(lockedUntil.getTime() - (Date.now() + minutes(15)))).toBeLessThan(5000);
  });

  it.each([1, 2, 3, 4])('con %i fallos todavía no se bloquea', async (count) => {
    userRepository.incrementFailedAttempts.mockResolvedValue({ failedLoginAttempts: count });

    await rejection(login({ ...credentials, password: 'incorrecta-123' }));

    expect(userRepository.lockUntil).not.toHaveBeenCalled();
  });

  it('con más de 5 fallos acumulados sigue bloqueando', async () => {
    userRepository.incrementFailedAttempts.mockResolvedValue({ failedLoginAttempts: 9 });
    await rejection(login({ ...credentials, password: 'incorrecta-123' }));
    expect(userRepository.lockUntil).toHaveBeenCalledTimes(1);
  });

  it('cuenta bloqueada -> 423 ACCOUNT_LOCKED con la hora en que termina', async () => {
    const lockedUntil = new Date(Date.now() + minutes(10));
    userRepository.findByEmailWithPermissions.mockResolvedValue({ ...user, lockedUntil });

    const err = await rejection(login(credentials));

    expect({ status: err.status, code: err.code }).toEqual({ status: 423, code: 'ACCOUNT_LOCKED' });
    expect(err.details).toEqual({ lockedUntil });
  });

  it('aunque la contraseña sea correcta, una cuenta bloqueada no inicia sesión', async () => {
    userRepository.findByEmailWithPermissions.mockResolvedValue({
      ...user,
      lockedUntil: new Date(Date.now() + minutes(10)),
    });

    await rejection(login(credentials));

    expect(refreshTokenRepository.create).not.toHaveBeenCalled();
  });

  it('mientras está bloqueada ni siquiera verifica la contraseña ni suma intentos', async () => {
    userRepository.findByEmailWithPermissions.mockResolvedValue({
      ...user,
      lockedUntil: new Date(Date.now() + minutes(10)),
    });

    await rejection(login({ ...credentials, password: 'incorrecta-123' }));

    expect(verifySpy).not.toHaveBeenCalled();
    expect(userRepository.incrementFailedAttempts).not.toHaveBeenCalled();
  });

  it('un bloqueo vencido + contraseña correcta -> inicia sesión y limpia el bloqueo', async () => {
    userRepository.findByEmailWithPermissions.mockResolvedValue({
      ...user,
      failedLoginAttempts: 5,
      lockedUntil: new Date(Date.now() - 1000),
    });

    const session = await login(credentials);

    expect(session.accessToken).toBeTruthy();
    expect(userRepository.resetLoginState).toHaveBeenCalledWith(USER_ID);
  });

  it('un bloqueo vencido + contraseña incorrecta reinicia el conteo ANTES de contar el nuevo fallo', async () => {
    userRepository.findByEmailWithPermissions.mockResolvedValue({
      ...user,
      failedLoginAttempts: 5,
      lockedUntil: new Date(Date.now() - 1000),
    });

    await rejection(login({ ...credentials, password: 'incorrecta-123' }));

    expect(userRepository.resetLoginState).toHaveBeenCalledWith(USER_ID);
    expect(userRepository.resetLoginState.mock.invocationCallOrder[0]).toBeLessThan(
      userRepository.incrementFailedAttempts.mock.invocationCallOrder[0],
    );
    expect(userRepository.lockUntil).not.toHaveBeenCalled();
  });
});

describe('refresh: criterio 4 (renovación con rotación del refresh token)', () => {
  const stored = {
    refreshTokenId: 'rt-1',
    userId: USER_ID,
    revokedAt: null,
    replacedBy: null,
    expiresAt: new Date(Date.now() + days(3)),
  };

  beforeEach(() => {
    refreshTokenRepository.findByHash.mockResolvedValue(stored);
    userRepository.findByIdWithPermissions.mockResolvedValue(user);
    refreshTokenRepository.rotate.mockResolvedValue({ refreshTokenId: 'rt-2' });
  });

  it('busca el token por su hash, nunca por su valor', async () => {
    await refresh('token-en-claro');
    expect(refreshTokenRepository.findByHash).toHaveBeenCalledWith(hashToken('token-en-claro'));
  });

  it('rota: invalida el anterior y guarda el hash del nuevo con 7 días', async () => {
    const session = await refresh('token-viejo');

    expect(refreshTokenRepository.rotate).toHaveBeenCalledTimes(1);
    const [oldId, next] = refreshTokenRepository.rotate.mock.calls[0];
    expect(oldId).toBe('rt-1');
    expect(next).toEqual({
      userId: USER_ID,
      tokenHash: hashToken(session.refreshToken),
      expiresAt: session.refreshExpiresAt,
    });
    expect(Math.abs(next.expiresAt.getTime() - (Date.now() + days(7)))).toBeLessThan(5000);
  });

  it('emite un access token nuevo y un refresh token distinto al presentado', async () => {
    const session = await refresh('token-viejo');

    const payload = jwt.verify(session.accessToken, publicKeyPem(), { algorithms: ['RS256'] });
    expect(payload).toMatchObject({ sub: USER_ID, role: 'WAITER' });
    expect(session.refreshToken).not.toBe('token-viejo');
    expect(session.user.userId).toBe(USER_ID);
  });

  it('el rol del nuevo access token sale de la base, no del token viejo (un cambio de rol se aplica al renovar)', async () => {
    userRepository.findByIdWithPermissions.mockResolvedValue({ ...user, role: 'COOK' });
    const session = await refresh('token-viejo');
    expect(jwt.decode(session.accessToken).role).toBe('COOK');
  });

  it.each([undefined, null, ''])('sin token (%o) -> 401 y no consulta la base', async (valor) => {
    const err = await rejection(refresh(valor));
    expect({ status: err.status, code: err.code }).toEqual({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    expect(refreshTokenRepository.findByHash).not.toHaveBeenCalled();
  });

  it('token desconocido -> 401', async () => {
    refreshTokenRepository.findByHash.mockResolvedValue(null);
    const err = await rejection(refresh('inventado'));
    expect({ status: err.status, code: err.code }).toEqual({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    expect(refreshTokenRepository.rotate).not.toHaveBeenCalled();
  });

  it('token vencido -> 401 sin rotar ni cerrar otras sesiones', async () => {
    refreshTokenRepository.findByHash.mockResolvedValue({
      ...stored,
      expiresAt: new Date(Date.now() - 1000),
    });

    await rejection(refresh('vencido'));

    expect(refreshTokenRepository.rotate).not.toHaveBeenCalled();
    expect(refreshTokenRepository.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('token ya ROTADO (reutilizado) -> 401 y se revocan TODAS las sesiones del usuario', async () => {
    refreshTokenRepository.findByHash.mockResolvedValue({
      ...stored,
      revokedAt: new Date(),
      replacedBy: 'rt-2',
    });

    const err = await rejection(refresh('ya-usado'));

    expect(err.status).toBe(401);
    expect(refreshTokenRepository.revokeAllForUser).toHaveBeenCalledWith(USER_ID);
    expect(refreshTokenRepository.rotate).not.toHaveBeenCalled();
  });

  it('token cerrado con logout (revocado, sin reemplazo) -> 401 sin cerrar las demás sesiones', async () => {
    refreshTokenRepository.findByHash.mockResolvedValue({
      ...stored,
      revokedAt: new Date(),
      replacedBy: null,
    });

    await rejection(refresh('cerrado'));

    expect(refreshTokenRepository.revokeAllForUser).not.toHaveBeenCalled();
    expect(refreshTokenRepository.rotate).not.toHaveBeenCalled();
  });

  it('usuario desactivado -> 401 y se revocan todas sus sesiones', async () => {
    userRepository.findByIdWithPermissions.mockResolvedValue({ ...user, isActive: false });

    await rejection(refresh('token'));

    expect(refreshTokenRepository.revokeAllForUser).toHaveBeenCalledWith(USER_ID);
    expect(refreshTokenRepository.rotate).not.toHaveBeenCalled();
  });

  it('usuario inexistente -> 401 y se revocan sus sesiones', async () => {
    userRepository.findByIdWithPermissions.mockResolvedValue(null);

    await rejection(refresh('token'));

    expect(refreshTokenRepository.revokeAllForUser).toHaveBeenCalledWith(USER_ID);
  });

  it('dos renovaciones simultáneas con el mismo token: la que pierde -> 401 y se cierran las sesiones', async () => {
    refreshTokenRepository.rotate.mockResolvedValue(null); // otro request ya lo rotó

    const err = await rejection(refresh('token'));

    expect(err.status).toBe(401);
    expect(refreshTokenRepository.revokeAllForUser).toHaveBeenCalledWith(USER_ID);
  });

  it('un 401 de sesión no distingue el motivo (mismo mensaje en todos los casos)', async () => {
    const mensajes = new Set();
    for (const setup of [
      () => refreshTokenRepository.findByHash.mockResolvedValue(null),
      () =>
        refreshTokenRepository.findByHash.mockResolvedValue({ ...stored, expiresAt: new Date(0) }),
      () =>
        refreshTokenRepository.findByHash.mockResolvedValue({ ...stored, revokedAt: new Date() }),
    ]) {
      setup();
      mensajes.add((await rejection(refresh('t'))).message);
    }
    expect([...mensajes]).toEqual(['Sesion no valida']);
  });
});

describe('logout', () => {
  it('revoca el refresh token presentado, buscándolo por su hash', async () => {
    await logout('token-en-claro');
    expect(refreshTokenRepository.revokeByHash).toHaveBeenCalledWith(hashToken('token-en-claro'));
  });

  it('solo cierra esa sesión: no revoca las demás del usuario', async () => {
    await logout('token');
    expect(refreshTokenRepository.revokeAllForUser).not.toHaveBeenCalled();
  });

  it.each([undefined, null, ''])(
    'sin token (%o) no hace nada y no falla (idempotente)',
    async (valor) => {
      await expect(logout(valor)).resolves.toBeUndefined();
      expect(refreshTokenRepository.revokeByHash).not.toHaveBeenCalled();
    },
  );
});
