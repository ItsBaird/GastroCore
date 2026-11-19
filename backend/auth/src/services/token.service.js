import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { getPrivateKey } from '../config/keys.js';
import { env } from '../config/env.js';

// Access token JWT RS256: sub = userId, role y permissions (15 min por defecto)
export function signAccessToken({ userId, role, permissions }) {
  return jwt.sign({ role, permissions }, getPrivateKey(), {
    algorithm: 'RS256',
    subject: userId,
    expiresIn: env.accessTokenTtlSeconds,
  });
}

// Se guarda solo el SHA-256 del refresh token (REQ-F01-04): si la base se filtra, los tokens no sirven
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Refresh token opaco de 256 bits aleatorios; vive 7 dias y se rota en cada uso
export function generateRefreshToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + env.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
  return { token, tokenHash: hashToken(token), expiresAt };
}
