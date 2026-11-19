import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AppError } from '../errors/AppError.js';
import { errorHandler } from './errorHandler.js';
import { validate } from './validate.js';

function fakeRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

describe('validate', () => {
  const schemas = {
    body: z.object({ n: z.string().trim() }),
    params: z.object({ id: z.uuid() }),
    query: z.object({ q: z.string().optional() }),
  };
  const ID = '33333333-3333-4333-8333-333333333333';

  it('deja los datos validados (y transformados) en req.valid y sigue', () => {
    const req = { body: { n: ' a ' }, params: { id: ID }, query: {} };
    const next = vi.fn();
    validate(schemas)(req, {}, next);
    expect(req.valid).toEqual({ body: { n: 'a' }, params: { id: ID }, query: {} });
    expect(next).toHaveBeenCalledWith();
  });

  it('solo valida las partes que se piden', () => {
    const req = { body: {}, params: { id: ID } };
    validate({ params: schemas.params })(req, {}, vi.fn());
    expect(Object.keys(req.valid)).toEqual(['params']);
  });

  it('si algo falla pasa el ZodError a next y no deja req.valid', () => {
    const req = { body: { n: 1 }, params: { id: ID } };
    const next = vi.fn();
    validate(schemas)(req, {}, next);
    expect(next.mock.calls[0][0]).toBeInstanceOf(z.ZodError);
    expect(req.valid).toBeUndefined();
  });
});

describe('errorHandler', () => {
  let spy;
  beforeEach(() => {
    spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => spy.mockRestore());

  const run = (err) => {
    const res = fakeRes();
    errorHandler(err, {}, res, vi.fn());
    return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
  };

  it('AppError conserva status, code, message y details', () => {
    const out = run(
      new AppError({
        status: 409,
        code: 'CONFLICT',
        message: 'repetido',
        details: { field: 'name' },
      }),
    );
    expect(out).toEqual({
      status: 409,
      body: { error: { code: 'CONFLICT', message: 'repetido', details: { field: 'name' } } },
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('ZodError -> 400 VALIDATION_ERROR con la ruta de cada campo', () => {
    const parsed = z.object({ a: z.object({ b: z.string() }) }).safeParse({ a: {} });
    const out = run(parsed.error);
    expect(out.status).toBe(400);
    expect(out.body.error.code).toBe('VALIDATION_ERROR');
    expect(out.body.error.details.fields).toEqual([{ path: 'a.b', message: expect.any(String) }]);
  });

  it('JSON mal formado -> 400 VALIDATION_ERROR', () => {
    const out = run(Object.assign(new Error('x'), { type: 'entity.parse.failed' }));
    expect(out.status).toBe(400);
    expect(out.body.error.message).toBe('JSON mal formado');
  });

  it('error desconocido -> 500 generico sin filtrar el mensaje interno, y se registra', () => {
    const out = run(new Error('password=secreto'));
    expect(out.status).toBe(500);
    expect(out.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor', details: {} },
    });
    expect(spy).toHaveBeenCalledOnce();
  });
});
