// GET /internal/tables/open con la app real. Solo el repositorio va simulado.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { findOpenTablesByWaiter } from '../repositories/table.repository.js';
import { startApp, tokenFor } from '../test/helpers.js';

vi.mock('../config/prisma.js', () => ({ prisma: {} }));
vi.mock('../repositories/table.repository.js', () => ({
  createTable: vi.fn(),
  findAllTablesOrderedByNumber: vi.fn(),
  findOpenTablesByWaiter: vi.fn(),
  findTableById: vi.fn(),
  updateTable: vi.fn(),
}));

const SERVICE_TOKEN = 'token-de-servicio-de-prueba';
const WAITER_ID = '22222222-2222-4222-8222-222222222222';
const URL = `/internal/tables/open?waiterId=${WAITER_ID}`;

let app;

function get(path, headers = {}) {
  return fetch(app.base + path, { headers });
}

beforeAll(async () => {
  process.env.SERVICE_TOKEN = SERVICE_TOKEN;
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  findOpenTablesByWaiter.mockResolvedValue([]);
});

describe('GET /internal/tables/open', () => {
  it('devuelve las mesas abiertas del mesero con su conteo', async () => {
    findOpenTablesByWaiter.mockResolvedValue([
      {
        tableId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        tableNumber: 2,
        qrToken: 'qr-2',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const res = await get(URL, { 'X-Service-Token': SERVICE_TOKEN });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      count: 1,
      tables: [
        { tableId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tableNumber: 2, qrToken: 'qr-2' },
      ],
    });
    expect(findOpenTablesByWaiter).toHaveBeenCalledWith(WAITER_ID);
  });

  it('un mesero sin mesas abiertas responde count 0', async () => {
    const res = await get(URL, { 'X-Service-Token': SERVICE_TOKEN });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 0, tables: [] });
  });

  it.each([
    ['sin cabecera', {}],
    ['con otro token', { 'X-Service-Token': 'otro' }],
    ['con un JWT de ADMIN en vez del token', { Authorization: `Bearer ${tokenFor('ADMIN')}` }],
  ])('%s responde 401 y no consulta la base', async (_label, headers) => {
    const res = await get(URL, headers);

    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
    expect(findOpenTablesByWaiter).not.toHaveBeenCalled();
  });

  it.each(['/internal/tables/open', '/internal/tables/open?waiterId=no-es-uuid'])(
    '%s responde 400',
    async (path) => {
      const res = await get(path, { 'X-Service-Token': SERVICE_TOKEN });

      expect(res.status).toBe(400);
      expect(findOpenTablesByWaiter).not.toHaveBeenCalled();
    },
  );
});
