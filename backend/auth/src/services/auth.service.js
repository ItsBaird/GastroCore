import argon2 from 'argon2';
import { ARGON2_OPTIONS } from '../config/argon2.js';
import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { refreshTokenRepository } from '../repositories/refreshToken.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { generateRefreshToken, hashToken, signAccessToken } from './token.service.js';

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

// Sesion invalida: sin refresh token, desconocido, vencido, revocado o ya rotado
function invalidSession() {
  return new AppError({ status: 401, code: 'UNAUTHENTICATED', message: 'Sesion no valida' });
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

  return issueSession(user);
}

const permissionCodes = (user) => user.permissions.map((up) => up.permission.code);

// Emite access token + refresh token nuevo para el usuario (login)
async function issueSession(user) {
  const permissions = permissionCodes(user);
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

// Renovacion con rotacion (REQ-F01-04): el refresh token usado queda invalidado y se emite uno nuevo.
// Si llega un token que ya fue rotado, alguien lo esta reutilizando (posible robo): se cierran
// todas las sesiones del usuario.
export async function refresh(plainToken) {
  if (!plainToken) throw invalidSession();

  const stored = await refreshTokenRepository.findByHash(hashToken(plainToken));
  if (!stored) throw invalidSession();

  if (stored.revokedAt) {
    if (stored.replacedBy) await refreshTokenRepository.revokeAllForUser(stored.userId);
    throw invalidSession();
  }
  if (stored.expiresAt <= new Date()) throw invalidSession();

  const user = await userRepository.findByIdWithPermissions(stored.userId);
  if (!user || !user.isActive) {
    await refreshTokenRepository.revokeAllForUser(stored.userId);
    throw invalidSession();
  }

  const next = generateRefreshToken();
  const rotated = await refreshTokenRepository.rotate(stored.refreshTokenId, {
    userId: user.userId,
    tokenHash: next.tokenHash,
    expiresAt: next.expiresAt,
  });
  if (!rotated) {
    // Otra peticion uso el mismo token un instante antes
    await refreshTokenRepository.revokeAllForUser(stored.userId);
    throw invalidSession();
  }

  const permissions = permissionCodes(user);
  return {
    accessToken: signAccessToken({ userId: user.userId, role: user.role, permissions }),
    refreshToken: next.token,
    refreshExpiresAt: next.expiresAt,
    user: { userId: user.userId, email: user.email, role: user.role, permissions },
  };
}

// Cierra la sesion: revoca ese refresh token. Es idempotente y no falla si no hay sesion.
export async function logout(plainToken) {
  if (!plainToken) return;
  await refreshTokenRepository.revokeByHash(hashToken(plainToken));
}
