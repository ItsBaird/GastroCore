import argon2 from 'argon2';
import { Prisma } from '@prisma/client';
import { AppError } from '../errors/AppError.js';
import { userRepository } from '../repositories/user.repository.js';

// Parametros minimos recomendados por OWASP para argon2id
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

// Nunca se expone passwordHash ni los contadores internos de bloqueo
export function toPublicUser(user) {
  return {
    userId: user.userId,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function createUser({ email, password, role }) {
  const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);
  try {
    const user = await userRepository.create({ email, passwordHash, role });
    return toPublicUser(user);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError({
        status: 409,
        code: 'EMAIL_ALREADY_EXISTS',
        message: 'El email ya esta registrado',
      });
    }
    throw err;
  }
}

export async function listUsers() {
  const users = await userRepository.findAll();
  return users.map(toPublicUser);
}

async function findExistingUser(userId) {
  const user = await userRepository.findById(userId);
  if (!user) {
    throw new AppError({ status: 404, code: 'NOT_FOUND', message: 'Usuario no encontrado' });
  }
  return user;
}

export async function getUser(userId) {
  return toPublicUser(await findExistingUser(userId));
}

// Evita que el sistema se quede sin administradores
function assertNotSelfDemotion(actorId, targetId, { role, isActive }) {
  const demotes = role !== undefined && role !== 'ADMIN';
  const deactivates = isActive === false;
  if (actorId === targetId && (demotes || deactivates)) {
    throw new AppError({
      status: 403,
      code: 'FORBIDDEN',
      message: 'No puedes desactivarte ni quitarte el rol de administrador a ti mismo',
    });
  }
}

export async function updateUser(actorId, userId, { role, isActive }) {
  assertNotSelfDemotion(actorId, userId, { role, isActive });
  await findExistingUser(userId);

  const data = {};
  if (role !== undefined) data.role = role;
  if (isActive !== undefined) {
    data.isActive = isActive;
    // Reactivar tambien levanta el bloqueo por intentos fallidos
    if (isActive) Object.assign(data, { failedLoginAttempts: 0, lockedUntil: null });
  }

  // Desactivar cierra las sesiones: se revocan sus refresh tokens
  const user = await userRepository.update(userId, data, { revokeSessions: isActive === false });
  return toPublicUser(user);
}

export async function deactivateUser(actorId, userId) {
  await updateUser(actorId, userId, { isActive: false });
}
