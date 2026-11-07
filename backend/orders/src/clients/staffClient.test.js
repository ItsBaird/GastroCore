import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { staffClient } from './staffClient.js';

const USER_ID = '22222222-2222-4222-8222-222222222222';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('staffClient.hasActiveShift', () => {
  it('consulta el turno activo con la cabecera de servicio', async () => {
    fetch.mockResolvedValue(json({ active: true }));

    await expect(staffClient.hasActiveShift(USER_ID)).resolves.toBe(true);

    const [url, options] = fetch.mock.calls[0];
    expect(url).toContain(`/internal/shifts/active/${USER_ID}`);
    expect(options.headers).toHaveProperty('X-Service-Token');
  });

  it('sin turno activo responde false', async () => {
    fetch.mockResolvedValue(json({ active: false }));

    await expect(staffClient.hasActiveShift(USER_ID)).resolves.toBe(false);
  });

  it.each([
    ['un error de Staff', () => fetch.mockResolvedValue(json({}, 500))],
    ['un token rechazado', () => fetch.mockResolvedValue(json({}, 401))],
    ['sin conexion', () => fetch.mockRejectedValue(new Error('ECONNREFUSED'))],
  ])('con %s responde 503 en vez de asumir un turno', async (_label, arrange) => {
    arrange();

    await expect(staffClient.hasActiveShift(USER_ID)).rejects.toMatchObject({
      status: 503,
      code: 'DEPENDENCY_UNAVAILABLE',
    });
  });
});

describe('staffClient.getEmployeeNames', () => {
  it('devuelve un mapa de userId a nombre', async () => {
    fetch.mockResolvedValue(json([{ userId: USER_ID, fullName: 'Carlos Rojas' }]));

    const names = await staffClient.getEmployeeNames([USER_ID]);

    expect(names.get(USER_ID)).toBe('Carlos Rojas');
  });

  it('sin ids no llama a Staff', async () => {
    await expect(staffClient.getEmployeeNames([])).resolves.toEqual(new Map());
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['un error de Staff', () => fetch.mockResolvedValue(json({}, 500))],
    ['sin conexion', () => fetch.mockRejectedValue(new Error('ECONNREFUSED'))],
  ])('con %s devuelve un mapa vacio sin lanzar', async (_label, arrange) => {
    arrange();

    await expect(staffClient.getEmployeeNames([USER_ID])).resolves.toEqual(new Map());
  });
});
