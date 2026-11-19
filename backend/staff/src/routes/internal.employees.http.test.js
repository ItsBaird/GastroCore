// GET /internal/employees con la app real. El repositorio va simulado.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { employeeRepository } from '../repositories/employee.repository.js';
import { MISSING_ID, USER_ID, startApp } from '../test/helpers.js';

vi.mock('../repositories/employee.repository.js', () => ({
  employeeRepository: { findNamesByIds: vi.fn() },
}));

const TOKEN = 'token-de-pruebas'; // el mismo de test/setup.js

let app;

const get = async (path, headers = { 'X-Service-Token': TOKEN }) => {
  const res = await fetch(app.base + path, { headers });
  return { status: res.status, body: await res.json().catch(() => null) };
};

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  employeeRepository.findNamesByIds.mockResolvedValue([]);
});

describe('GET /internal/employees', () => {
  it('devuelve el nombre de cada empleado encontrado', async () => {
    employeeRepository.findNamesByIds.mockResolvedValue([
      { userId: USER_ID, fullName: 'Carlos Rojas' },
    ]);

    const res = await get(`/internal/employees?ids=${USER_ID},${MISSING_ID},${USER_ID}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ userId: USER_ID, fullName: 'Carlos Rojas' }]);
    expect(employeeRepository.findNamesByIds).toHaveBeenCalledWith([USER_ID, MISSING_ID]);
  });

  it.each([
    ['sin cabecera', {}],
    ['con otro token', { 'X-Service-Token': 'otro' }],
  ])('%s responde 401 y no consulta la base', async (_label, headers) => {
    const res = await get(`/internal/employees?ids=${USER_ID}`, headers);

    expect(res.status).toBe(401);
    expect(employeeRepository.findNamesByIds).not.toHaveBeenCalled();
  });

  it.each(['/internal/employees', '/internal/employees?ids=no-es-uuid'])(
    '%s responde 400',
    async (path) => {
      const res = await get(path);

      expect(res.status).toBe(400);
      expect(employeeRepository.findNamesByIds).not.toHaveBeenCalled();
    },
  );
});
