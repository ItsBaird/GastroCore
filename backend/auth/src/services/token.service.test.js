import { createHash, generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { ADMIN_ID, publicKeyPem } from '../test/helpers.js';
import { generateRefreshToken, hashToken, signAccessToken } from './token.service.js';

const claims = { userId: ADMIN_ID, role: 'ADMIN', permissions: ['discount:apply'] };
const decodeHeader = (token) =>
  JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());

describe('signAccessToken (GC-AUTH-0002, criterio 1: access token de 15 min)', () => {
  it('firma un JWT con RS256', () => {
    expect(decodeHeader(signAccessToken(claims)).alg).toBe('RS256');
  });

  it('lleva sub = userId, role y permissions', () => {
    const payload = jwt.verify(signAccessToken(claims), publicKeyPem(), { algorithms: ['RS256'] });
    expect(payload).toMatchObject({
      sub: ADMIN_ID,
      role: 'ADMIN',
      permissions: ['discount:apply'],
    });
  });

  it('vive 15 minutos (900 s)', () => {
    const payload = jwt.decode(signAccessToken(claims));
    expect(payload.exp - payload.iat).toBe(900);
  });

  it('no incluye datos sensibles: ni email, ni contraseña, ni hash', () => {
    const payload = jwt.decode(signAccessToken(claims));
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'permissions', 'role', 'sub']);
  });

  it('se verifica con la clave pública pero no con otra clave', () => {
    const token = signAccessToken(claims);
    const { publicKey: otra } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    expect(() => jwt.verify(token, publicKeyPem(), { algorithms: ['RS256'] })).not.toThrow();
    expect(() => jwt.verify(token, otra, { algorithms: ['RS256'] })).toThrow(/invalid signature/);
  });

  it('un token alterado deja de ser válido', () => {
    const [header, , signature] = signAccessToken(claims).split('.');
    const falso = Buffer.from(
      JSON.stringify({
        sub: ADMIN_ID,
        role: 'ADMIN',
        permissions: ['todo'],
        iat: 1,
        exp: 9999999999,
      }),
    ).toString('base64url');
    expect(() =>
      jwt.verify(`${header}.${falso}.${signature}`, publicKeyPem(), { algorithms: ['RS256'] }),
    ).toThrow();
  });

  it('permissions vacío se conserva como arreglo vacío', () => {
    const payload = jwt.decode(signAccessToken({ ...claims, permissions: [] }));
    expect(payload.permissions).toEqual([]);
  });
});

describe('hashToken', () => {
  it('es el SHA-256 en hexadecimal (64 caracteres) y determinista', () => {
    const hash = hashToken('un-token');
    expect(hash).toBe(createHash('sha256').update('un-token').digest('hex'));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken('un-token')).toBe(hash);
  });

  it('tokens distintos dan hashes distintos y el hash no revela el token', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
    expect(hashToken('un-token')).not.toContain('un-token');
  });
});

describe('generateRefreshToken (criterio 1: refresh token de 7 días)', () => {
  it('es opaco: 256 bits aleatorios en base64url (43 caracteres), no un JWT', () => {
    const { token } = generateRefreshToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token.split('.')).toHaveLength(1);
  });

  it('devuelve el hash que se guarda en la base, distinto del token', () => {
    const { token, tokenHash } = generateRefreshToken();
    expect(tokenHash).toBe(hashToken(token));
    expect(tokenHash).not.toBe(token);
  });

  it('vence a los 7 días', () => {
    const { expiresAt } = generateRefreshToken();
    const sieteDias = 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(expiresAt.getTime() - (Date.now() + sieteDias))).toBeLessThan(5000);
  });

  it('nunca repite un token (200 generados)', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateRefreshToken().token));
    expect(tokens.size).toBe(200);
  });
});
