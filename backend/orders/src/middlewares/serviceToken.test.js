import { describe, expect, it, vi } from 'vitest';
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
    const { next, error } = run(requireServiceToken('secreto'), 'secreto');

    expect(error).toBeNull();
    expect(next).toHaveBeenCalledOnce();
  });

  it.each([undefined, '', 'otro', 'SECRETO', 'secreto '])('token %j responde 401', (token) => {
    const { next, error } = run(requireServiceToken('secreto'), token);

    expect(error).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(next).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'cualquiera'])(
    'falla cerrado: sin token en el servidor, %j tambien responde 401',
    (token) => {
      const { next, error } = run(requireServiceToken(''), token);

      expect(error).toMatchObject({ status: 401 });
      expect(next).not.toHaveBeenCalled();
    },
  );
});
