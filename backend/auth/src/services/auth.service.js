import argon2 from 'argon2';
import { ARGON2_OPTIONS } from '../config/argon2.js';
import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { refreshTokenRepository } from '../repositories/refreshToken.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { generateRefreshToken, signAccessToken } from './token.service.js';

// Hash de relleno: si el email no existe se verifica igual, para que la respuesta
// tarde lo mismo y no revele si la cuenta existe
const DUMMY_HASH = await argon2.hash('contrasena-de-relleno', ARGON2_OPTIONS);

// Mismo error para email inexistente, contrasena incorrecta y cuenta inactiva (REQ-F01-08)
function invalidCredentials() {
  return new AppError({
    status: 401,
    code: 'UNAUTHENTICATED',
    message: 'Credenciales invalidas',
  });
}

function accountLocked(lockedUntil) {
  return new AppError({
    status: 423,
    code: 'ACCOUNT_LOCKED',
    message: 'Cuenta bloqueada temporalmente por demasiados intentos fallidos',
    details: { lockedUntil },
  });
}

async function registerFailedAttempt(user) {
  // Un bloqueo ya vencido empieza el conteo de nuevo
  if (user.lockedUntil && user.lockedUntil <= new Date()) {
    await userRepository.resetLoginState(user.userId);
  }
  const { failedLoginAttempts } = await userRepository.incrementFailedAttempts(user.userId);
  if (failedLoginAttempts >= env.loginMaxAttempts) {
    const lockedUntil = new Date(Date.now() + env.loginLockMinutes * 60 * 1000);
    await userRepository.lockUntil(user.userId, lockedUntil);
  }
}

export async function login({ email, password }) {
  const user = await userRepository.findByEmailWithPermissions(email);

  if (!user) {
    await argon2.verify(DUMMY_HASH, password);
    throw invalidCredentials();
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw accountLocked(user.lockedUntil);
  }

  if (!(await argon2.verify(user.passwordHash, password))) {
    await registerFailedAttempt(user);
    throw invalidCredentials();
  }

  // Cuenta desactivada: no cuenta como intento fallido ni dice por que se rechaza
  if (!user.isActive) throw invalidCredentials();

  if (user.failedLoginAttempts > 0 || user.lockedUntil) {
    await userRepository.resetLoginState(user.userId);
  }

  const permissions = user.permissions.map((up) => up.permission.code);
  const accessToken = signAccessToken({ userId: user.userId, role: user.role, permissions });

  const refresh = generateRefreshToken();
  await refreshTokenRepository.create({
    userId: user.userId,
    tokenHash: refresh.tokenHash,
    expiresAt: refresh.expiresAt,
  });

  return {
    accessToken,
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
    user: { userId: user.userId, email: user.email, role: user.role, permissions },
  };
}
