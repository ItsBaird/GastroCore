// GET /internal/shifts/active/:userId (REQ-F02-05) con la app real. El repositorio va simulado.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { shiftRepository } from '../repositories/shift.repository.js';
import { MISSING_ID, SHIFT_ID, USER_ID, makeShift, startApp } from '../test/helpers.js';

vi.mock('../repositories/shift.repository.js', () => ({
  shiftRepository: { findActiveByUserId: vi.fn() },
}));

let app;
const TOKEN = 'token-de-pruebas'; // el mismo de test/setup.js

const get = (path, token) =>
  fetch(app.base + path, { headers: token === undefined ? {} : { 'X-Service-Token': token } }).then(
    async (res) => ({ status: res.status, body: await res.json().catch(() => null) }),
  );

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
});

describe('autenticacion entre servicios', () => {
  it('sin X-Service-Token -> 401 y no consulta la base', async () => {
    const res = await get(`/internal/shifts/active/${USER_ID}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(shiftRepository.findActiveByUserId).not.toHaveBeenCalled();
  });

  it.each(['', 'otro-token', TOKEN.toUpperCase(), TOKEN.slice(0, -1), `${TOKEN}x`])(
    'token incorrecto %j -> 401',
    async (token) => {
      const res = await get(`/internal/shifts/active/${USER_ID}`, token);
      expect(res.status).toBe(401);
      expect(shiftRepository.findActiveByUserId).not.toHaveBeenCalled();
    },
  );

  it('un access token JWT de usuario no sirve como token de servicio', async () => {
    const res = await fetch(`${app.base}/internal/shifts/active/${USER_ID}`, {
      headers: { Authorization: 'Bearer cualquiera' },
    });
    expect(res.status).toBe(401);
  });

  it('/internal/health sigue abierto (solo comprueba que el gateway bloquea /internal)', async () => {
    const res = await get('/internal/health');
    expect(res.status).toBe(200);
  });
});

describe('GET /internal/shifts/active/:userId', () => {
  const active = () =>
    makeShift({ status: 'activo', actualStart: new Date('2026-11-09T13:05:00Z') });

  it('con turno activo -> { active: true, shift }', async () => {
    shiftRepository.findActiveByUserId.mockResolvedValue(active());
    const res = await get(`/internal/shifts/active/${USER_ID}`, TOKEN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      active: true,
      shift: {
        shiftId: SHIFT_ID,
        userId: USER_ID,
        scheduledStart: '2026-11-09T13:00:00.000Z',
        scheduledEnd: '2026-11-09T21:00:00.000Z',
        actualStart: '2026-11-09T13:05:00.000Z',
        actualEnd: null,
        status: 'activo',
      },
    });
    expect(shiftRepository.findActiveByUserId).toHaveBeenCalledWith(USER_ID);
  });

  it('sin turno activo -> { active: false } y sin la clave shift', async () => {
    shiftRepository.findActiveByUserId.mockResolvedValue(null);
    const res = await get(`/internal/shifts/active/${MISSING_ID}`, TOKEN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ active: false });
  });

  it('userId que no es UUID -> 400', async () => {
    const res = await get('/internal/shifts/active/123', TOKEN);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('error inesperado de la base -> 500 sin filtrar detalles', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    shiftRepository.findActiveByUserId.mockRejectedValue(new Error('password=secreto'));
    const res = await get(`/internal/shifts/active/${USER_ID}`, TOKEN);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secreto');
    spy.mockRestore();
  });

  it('no existe una version publica bajo /api/staff (solo red interna)', async () => {
    const res = await get(`/api/staff/shifts/active/${USER_ID}`, TOKEN);
    expect(res.status).toBe(404);
  });
});
