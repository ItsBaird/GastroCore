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
