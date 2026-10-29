import { Prisma } from '@prisma/client';
import argon2 from 'argon2';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors/AppError.js';
import { userRepository } from '../repositories/user.repository.js';
import { ADMIN_ID, MISSING_ID, USER_ID, makeUser } from '../test/helpers.js';
import {
  createUser,
  deactivateUser,
  getUser,
  listUsers,
  toPublicUser,
  updateUser,
} from './user.service.js';

vi.mock('../repositories/user.repository.js', () => ({
  userRepository: { create: vi.fn(), findAll: vi.fn(), findById: vi.fn(), update: vi.fn() },
}));

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed on users.email', {
    code: 'P2002',
    clientVersion: '6.19.3',
    meta: { target: ['uq_users_email'] },
  });

// Comprueba que la promesa falla con un AppError con ese status y code
async function expectAppError(promise, status, code) {
  const err = await promise.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect({ status: err.status, code: err.code }).toEqual({ status, code });
  return err;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('toPublicUser', () => {
  it('expone solo los datos públicos: nunca el hash ni los contadores de bloqueo', () => {
    const user = makeUser({ failedLoginAttempts: 3, lockedUntil: new Date() });
    expect(toPublicUser(user)).toEqual({
      userId: user.userId,
      email: user.email,
      role: user.role,
      isActive: true,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  });
});

describe('createUser (GC-AUTH-0001, criterios 1 y 2)', () => {
  const input = { email: 'cocinero@lapizzeta.com', password: 'ClaveTemporal12', role: 'COOK' };

  it('crea la cuenta y responde con los datos del usuario creado, sin hash', async () => {
    userRepository.create.mockImplementation(async (data) => makeUser({ ...data }));

    const created = await createUser(input);

    expect(created).toMatchObject({ email: input.email, role: 'COOK', isActive: true });
    expect(created.userId).toMatch(/^[0-9a-f-]{36}$/);
    expect(created).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(created)).not.toContain('argon2');
  });

  it('guarda la contraseña con argon2id y nunca en claro', async () => {
    userRepository.create.mockImplementation(async (data) => makeUser({ ...data }));

    await createUser(input);

    const saved = userRepository.create.mock.calls[0][0];
    expect(saved).toEqual({
      email: input.email,
      role: 'COOK',
      passwordHash: expect.stringMatching(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/),
    });
    expect(saved.passwordHash).not.toContain(input.password);
    expect(await argon2.verify(saved.passwordHash, input.password)).toBe(true);
    expect(await argon2.verify(saved.passwordHash, 'otra-contrasena')).toBe(false);
  });

  it('dos usuarios con la misma contraseña obtienen hashes distintos (sal aleatoria)', async () => {
    userRepository.create.mockImplementation(async (data) => makeUser({ ...data }));

    await createUser(input);
    await createUser({ ...input, email: 'otro@lapizzeta.com' });

    const [a, b] = userRepository.create.mock.calls.map(([data]) => data.passwordHash);
    expect(a).not.toBe(b);
  });

  it('email repetido -> 409 EMAIL_ALREADY_EXISTS (criterio 2)', async () => {
    userRepository.create.mockRejectedValue(uniqueViolation());

    const err = await expectAppError(createUser(input), 409, 'EMAIL_ALREADY_EXISTS');
    expect(err.message).toBe('El email ya esta registrado');
  });

  it('un error de base de datos distinto de "valor duplicado" no se disfraza de 409', async () => {
    const otro = new Prisma.PrismaClientKnownRequestError('FK', {
      code: 'P2003',
      clientVersion: '6.19.3',
    });
    userRepository.create.mockRejectedValue(otro);
    await expect(createUser(input)).rejects.toBe(otro);

    const caida = new Error('conexion perdida');
    userRepository.create.mockRejectedValue(caida);
    await expect(createUser(input)).rejects.toBe(caida);
  });
});

describe('listUsers', () => {
  it('devuelve todos los usuarios sin datos sensibles', async () => {
    userRepository.findAll.mockResolvedValue([
      makeUser({ userId: ADMIN_ID, email: 'admin@lapizzeta.com', role: 'ADMIN' }),
      makeUser({ failedLoginAttempts: 2 }),
    ]);

    const users = await listUsers();

    expect(users.map((u) => u.email)).toEqual(['admin@lapizzeta.com', 'mesero@lapizzeta.com']);
    users.forEach((u) => expect(Object.keys(u)).not.toContain('passwordHash'));
    expect(JSON.stringify(users)).not.toMatch(/passwordHash|failedLoginAttempts|lockedUntil/);
  });

  it('devuelve una lista vacía si no hay usuarios', async () => {
    userRepository.findAll.mockResolvedValue([]);
    expect(await listUsers()).toEqual([]);
  });
});

describe('getUser', () => {
  it('devuelve el usuario público', async () => {
    userRepository.findById.mockResolvedValue(makeUser());
    expect(await getUser(USER_ID)).toMatchObject({
      userId: USER_ID,
      email: 'mesero@lapizzeta.com',
    });
    expect(userRepository.findById).toHaveBeenCalledWith(USER_ID);
  });

  it('usuario inexistente -> 404 NOT_FOUND', async () => {
    userRepository.findById.mockResolvedValue(null);
    await expectAppError(getUser(MISSING_ID), 404, 'NOT_FOUND');
  });
});

describe('updateUser (REQ-F01-07)', () => {
  beforeEach(() => {
    userRepository.findById.mockResolvedValue(makeUser());
    userRepository.update.mockImplementation(async (id, data) => makeUser({ ...data }));
  });

  it('cambia el rol sin tocar la sesión ni el bloqueo', async () => {
    const out = await updateUser(ADMIN_ID, USER_ID, { role: 'COOK' });

    expect(userRepository.update).toHaveBeenCalledWith(
      USER_ID,
      { role: 'COOK' },
      { revokeSessions: false },
    );
    expect(out.role).toBe('COOK');
  });

  it('desactivar (isActive=false) revoca los refresh tokens del usuario', async () => {
    await updateUser(ADMIN_ID, USER_ID, { isActive: false });

    expect(userRepository.update).toHaveBeenCalledWith(
      USER_ID,
      { isActive: false },
      { revokeSessions: true },
    );
  });

  it('reactivar (isActive=true) limpia el contador de intentos y el bloqueo', async () => {
    await updateUser(ADMIN_ID, USER_ID, { isActive: true });

    expect(userRepository.update).toHaveBeenCalledWith(
      USER_ID,
      { isActive: true, failedLoginAttempts: 0, lockedUntil: null },
      { revokeSessions: false },
    );
  });

  it('puede cambiar rol y estado a la vez', async () => {
    await updateUser(ADMIN_ID, USER_ID, { role: 'WAITER', isActive: false });

    expect(userRepository.update).toHaveBeenCalledWith(
      USER_ID,
      { role: 'WAITER', isActive: false },
      { revokeSessions: true },
    );
  });

  it('solo envía a la base lo que cambió (un campo omitido no se sobrescribe)', async () => {
    await updateUser(ADMIN_ID, USER_ID, { role: 'COOK' });
    expect(Object.keys(userRepository.update.mock.calls[0][1])).toEqual(['role']);
  });

  it('usuario inexistente -> 404 y no se actualiza nada', async () => {
    userRepository.findById.mockResolvedValue(null);

    await expectAppError(updateUser(ADMIN_ID, MISSING_ID, { role: 'COOK' }), 404, 'NOT_FOUND');
    expect(userRepository.update).not.toHaveBeenCalled();
  });

  describe('un ADMIN no puede dejar el sistema sin administradores', () => {
    it.each([
      ['quitarse el rol', { role: 'WAITER' }],
      ['pasar a cocinero', { role: 'COOK' }],
      ['desactivarse', { isActive: false }],
      ['quitarse el rol y desactivarse', { role: 'COOK', isActive: false }],
    ])(
      'rechaza %s a sí mismo con 403 FORBIDDEN y no consulta ni modifica la base',
      async (_t, changes) => {
        await expectAppError(updateUser(ADMIN_ID, ADMIN_ID, changes), 403, 'FORBIDDEN');
        expect(userRepository.findById).not.toHaveBeenCalled();
        expect(userRepository.update).not.toHaveBeenCalled();
      },
    );

    it('sí permite confirmarse como ADMIN o activarse a sí mismo', async () => {
      userRepository.findById.mockResolvedValue(makeUser({ userId: ADMIN_ID, role: 'ADMIN' }));

      await expect(updateUser(ADMIN_ID, ADMIN_ID, { role: 'ADMIN' })).resolves.toBeDefined();
      await expect(updateUser(ADMIN_ID, ADMIN_ID, { isActive: true })).resolves.toBeDefined();
    });

    it('un ADMIN sí puede degradar o desactivar a OTRO administrador', async () => {
      userRepository.findById.mockResolvedValue(makeUser({ role: 'ADMIN' }));

      await expect(updateUser(ADMIN_ID, USER_ID, { role: 'WAITER' })).resolves.toBeDefined();
      await expect(updateUser(ADMIN_ID, USER_ID, { isActive: false })).resolves.toBeDefined();
    });
  });
});

describe('deactivateUser (DELETE = desactivación lógica)', () => {
  beforeEach(() => {
    userRepository.findById.mockResolvedValue(makeUser());
    userRepository.update.mockImplementation(async (id, data) => makeUser({ ...data }));
  });

  it('marca al usuario como inactivo y revoca sus sesiones; no borra el registro', async () => {
    await expect(deactivateUser(ADMIN_ID, USER_ID)).resolves.toBeUndefined();

    expect(userRepository.update).toHaveBeenCalledWith(
      USER_ID,
      { isActive: false },
      { revokeSessions: true },
    );
  });

  it('es idempotente: desactivar a un usuario ya inactivo no falla', async () => {
    userRepository.findById.mockResolvedValue(makeUser({ isActive: false }));
    await expect(deactivateUser(ADMIN_ID, USER_ID)).resolves.toBeUndefined();
  });

  it('el ADMIN no puede desactivarse a sí mismo', async () => {
    await expectAppError(deactivateUser(ADMIN_ID, ADMIN_ID), 403, 'FORBIDDEN');
    expect(userRepository.update).not.toHaveBeenCalled();
  });

  it('usuario inexistente -> 404', async () => {
    userRepository.findById.mockResolvedValue(null);
    await expectAppError(deactivateUser(ADMIN_ID, MISSING_ID), 404, 'NOT_FOUND');
  });
});
