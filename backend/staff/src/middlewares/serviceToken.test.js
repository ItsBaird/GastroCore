import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors/AppError.js';
import { requireServiceToken } from './serviceToken.js';

const reqWith = (token) => ({ get: (name) => (name === 'X-Service-Token' ? token : undefined) });

function run(middleware, token) {
  const next = vi.fn();
  let error = null;
  try {
    middleware(reqWith(token), {}, next);
  } catch (err) {
    error = err;
  }
  return { next, error };
}

describe('requireServiceToken', () => {
  it('con el token correcto deja pasar', () => {
    const { next, error } = run(requireServiceToken('secreto-largo'), 'secreto-largo');
    expect(error).toBeNull();
    expect(next).toHaveBeenCalledOnce();
  });

  it.each([undefined, '', 'otro', 'SECRETO-LARGO', 'secreto-larg', 'secreto-largo '])(
    'token %j -> 401 UNAUTHENTICATED',
    (token) => {
      const { next, error } = run(requireServiceToken('secreto-largo'), token);
      expect(error).toBeInstanceOf(AppError);
      expect({ status: error.status, code: error.code }).toEqual({
        status: 401,
        code: 'UNAUTHENTICATED',
      });
      expect(next).not.toHaveBeenCalled();
    },
  );

  it('falla cerrado: sin token configurado en el servidor no pasa nadie, ni con cabecera vacia', () => {
    for (const token of [undefined, '', 'cualquiera']) {
      const { next, error } = run(requireServiceToken(''), token);
      expect(error.status).toBe(401);
      expect(next).not.toHaveBeenCalled();
    }
  });

  it('acepta tokens con caracteres no ASCII y de distinta longitud sin lanzar otro error', () => {
    const { error } = run(requireServiceToken('clave-ñandú'), 'x');
    expect(error.status).toBe(401);
    expect(run(requireServiceToken('clave-ñandú'), 'clave-ñandú').error).toBeNull();
  });
});
