import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors/AppError.js';
import { ADMIN_ID, tokenFor } from '../test/helpers.js';
import { authenticate, requirePermission, requireRole } from './authenticate.js';

const privateKey = () => process.env.JWT_PRIVATE_KEY_PATH;

// Ejecuta un middleware y devuelve { error } si lanzó, o { req, next } si dejó pasar
function run(middleware, req) {
  const next = vi.fn();
  try {
    middleware(req, {}, next);
  } catch (error) {
    return { error, next };
  }
  return { error: null, next };
}
const withToken = (token, scheme = 'Bearer') => ({
  headers: { authorization: `${scheme} ${token}` },
});

function expectError(result, status, code) {
  expect(result.error).toBeInstanceOf(AppError);
  expect({ status: result.error.status, code: result.error.code }).toEqual({ status, code });
  expect(result.next).not.toHaveBeenCalled();
}

// subject: null firma el token sin "sub"
function signWith(claims, options = {}, key) {
  const opts = { algorithm: 'RS256', subject: ADMIN_ID, expiresIn: '15m', ...options };
  if (opts.subject === null) delete opts.subject;
  return jwt.sign(claims, key ?? fs.readFileSync(privateKey()), opts);
}

describe('authenticate: token válido', () => {
  it('deja pasar y carga req.user con userId, rol y permisos', () => {
    const req = withToken(tokenFor('WAITER', { permissions: ['discount:apply'] }));
    const result = run(authenticate, req);

    expect(result.error).toBeNull();
    expect(result.next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual({ userId: ADMIN_ID, role: 'WAITER', permissions: ['discount:apply'] });
  });

  it.each(['ADMIN', 'WAITER', 'COOK'])('acepta el rol %s', (role) => {
    expect(run(authenticate, withToken(tokenFor(role))).error).toBeNull();
  });

  it('si el token no trae permissions, req.user.permissions es []', async () => {
    const req = withToken(await signWith({ role: 'ADMIN' }));
    run(authenticate, req);
    expect(req.user.permissions).toEqual([]);
  });

  it('si permissions no es un arreglo, lo ignora', async () => {
    const req = withToken(await signWith({ role: 'ADMIN', permissions: 'todo' }));
    run(authenticate, req);
    expect(req.user.permissions).toEqual([]);
  });
});

describe('authenticate: rechazos -> 401 UNAUTHENTICATED', () => {
  it('sin cabecera Authorization', () => {
    expectError(run(authenticate, { headers: {} }), 401, 'UNAUTHENTICATED');
  });

  it('cabecera vacía', () => {
    expectError(run(authenticate, { headers: { authorization: '' } }), 401, 'UNAUTHENTICATED');
  });

  it('esquema distinto de Bearer', () => {
    expectError(run(authenticate, withToken(tokenFor('ADMIN'), 'Basic')), 401, 'UNAUTHENTICATED');
  });

  it('"Bearer" sin token', () => {
    expectError(
      run(authenticate, { headers: { authorization: 'Bearer' } }),
      401,
      'UNAUTHENTICATED',
    );
  });

  it('un valor que no es un JWT', () => {
    expectError(run(authenticate, withToken('abc.def.ghi')), 401, 'UNAUTHENTICATED');
    expectError(run(authenticate, withToken('basura')), 401, 'UNAUTHENTICATED');
  });

  it('token vencido', async () => {
    const vencido = await signWith({ role: 'ADMIN', permissions: [] }, { expiresIn: -60 });
    expectError(run(authenticate, withToken(vencido)), 401, 'UNAUTHENTICATED');
  });

  it('token que todavía no es válido (nbf futuro)', async () => {
    const futuro = await signWith({ role: 'ADMIN', permissions: [] }, { notBefore: '1h' });
    expectError(run(authenticate, withToken(futuro)), 401, 'UNAUTHENTICATED');
  });

  it('firmado con otra clave RSA', async () => {
    const { privateKey: ajena } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const falso = await signWith({ role: 'ADMIN', permissions: [] }, {}, ajena);
    expectError(run(authenticate, withToken(falso)), 401, 'UNAUTHENTICATED');
  });

  it('ataque de confusión de algoritmo: HS256 firmado con la clave pública', async () => {
    const publica = fs.readFileSync(process.env.JWT_PUBLIC_KEY_PATH, 'utf8');
    const hs = jwt.sign({ role: 'ADMIN' }, publica, { algorithm: 'HS256', subject: ADMIN_ID });
    expectError(run(authenticate, withToken(hs)), 401, 'UNAUTHENTICATED');
  });

  it('token sin firma (alg none)', () => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: ADMIN_ID, role: 'ADMIN' })}.`;
    expectError(run(authenticate, withToken(none)), 401, 'UNAUTHENTICATED');
  });

  it('un rol que no existe en el sistema', async () => {
    const raro = await signWith({ role: 'SUPERADMIN', permissions: [] });
    expectError(run(authenticate, withToken(raro)), 401, 'UNAUTHENTICATED');
  });

  it('sin rol', async () => {
    expectError(
      run(authenticate, withToken(await signWith({ permissions: [] }))),
      401,
      'UNAUTHENTICATED',
    );
  });

  it('sin sub (userId)', async () => {
    const sinSub = await signWith({ role: 'ADMIN' }, { subject: null });
    expectError(run(authenticate, withToken(sinSub)), 401, 'UNAUTHENTICATED');
  });

  it('un token alterado a mano (payload modificado)', () => {
    const [h, , s] = tokenFor('WAITER').split('.');
    const payload = Buffer.from(
      JSON.stringify({ sub: ADMIN_ID, role: 'ADMIN', exp: 9999999999 }),
    ).toString('base64url');
    expectError(run(authenticate, withToken(`${h}.${payload}.${s}`)), 401, 'UNAUTHENTICATED');
  });

  it('el mensaje no revela el motivo del rechazo', () => {
    const mensajes = new Set([
      run(authenticate, { headers: {} }).error.message,
      run(authenticate, withToken('basura')).error.message,
    ]);
    expect([...mensajes]).toEqual(['Sesion no valida']);
  });
});

describe('authenticate: clave pública ausente', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('responde 500 INTERNAL_ERROR (no 401) y deja un aviso en el log, sin tumbar el servicio', async () => {
    const original = process.env.JWT_PUBLIC_KEY_PATH;
    const token = tokenFor('ADMIN');
    process.env.JWT_PUBLIC_KEY_PATH = '/ruta/que/no/existe/jwt_public.pem';
    vi.resetModules();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const fresh = await import('./authenticate.js');
      // Tras resetModules la clase AppError es otra instancia: se compara por forma, no con instanceof
      const result = run(fresh.authenticate, withToken(token));
      expect(result.error).toMatchObject({ name: 'AppError', status: 500, code: 'INTERNAL_ERROR' });
      expect(result.next).not.toHaveBeenCalled();
      expect(log.mock.calls[0][0]).toContain('generate-keys.sh');
    } finally {
      process.env.JWT_PUBLIC_KEY_PATH = original;
    }
  });
});

describe('requireRole', () => {
  const as = (role) => ({ user: { userId: ADMIN_ID, role, permissions: [] } });

  it('deja pasar a un rol permitido', () => {
    expect(run(requireRole('ADMIN'), as('ADMIN')).error).toBeNull();
  });

  it('acepta varios roles (donde dice WAITER, también el ADMIN: se pasa explícito)', () => {
    const mw = requireRole('WAITER', 'ADMIN');
    expect(run(mw, as('WAITER')).error).toBeNull();
    expect(run(mw, as('ADMIN')).error).toBeNull();
  });

  it('un rol no permitido -> 403 FORBIDDEN', () => {
    expectError(run(requireRole('ADMIN'), as('WAITER')), 403, 'FORBIDDEN');
    expectError(run(requireRole('WAITER', 'ADMIN'), as('COOK')), 403, 'FORBIDDEN');
  });

  it('sin usuario autenticado -> 403 (nunca deja pasar por defecto)', () => {
    expectError(run(requireRole('ADMIN'), {}), 403, 'FORBIDDEN');
  });

  it('el ADMIN no entra solo por ser ADMIN: la ruta debe listarlo', () => {
    expectError(run(requireRole('WAITER'), as('ADMIN')), 403, 'FORBIDDEN');
  });
});

describe('requirePermission', () => {
  const con = (permissions) => ({ user: { userId: ADMIN_ID, role: 'WAITER', permissions } });

  it('deja pasar a quien tiene el permiso', () => {
    expect(run(requirePermission('discount:apply'), con(['discount:apply'])).error).toBeNull();
  });

  it('sin el permiso -> 403 FORBIDDEN', () => {
    expectError(run(requirePermission('discount:apply'), con([])), 403, 'FORBIDDEN');
    expectError(run(requirePermission('discount:apply'), con(['otro:permiso'])), 403, 'FORBIDDEN');
  });

  it('el permiso se compara completo, no por prefijo', () => {
    expectError(run(requirePermission('discount:apply'), con(['discount'])), 403, 'FORBIDDEN');
  });

  it('sin usuario autenticado -> 403', () => {
    expectError(run(requirePermission('discount:apply'), {}), 403, 'FORBIDDEN');
  });
});
