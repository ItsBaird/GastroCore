// GET /api/orders/history/export (GC-RPT-0003, GC-190) con la app real: roles, cabeceras de descarga, 422 y
// validacion. El repositorio y Staff van simulados; el .xlsx se genera de verdad.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { staffClient } from '../clients/staffClient.js';
import {
  aggregateHistory,
  findHistoryForExport,
  findHistoryOrder,
} from '../repositories/history.repository.js';
import { startApp, tokenFor } from '../test/helpers.js';

vi.mock('../config/prisma.js', () => ({ prisma: {} }));
vi.mock('../repositories/history.repository.js', () => ({
  findHistoryPage: vi.fn(),
  findHistoryOrder: vi.fn(),
  findHistoryForExport: vi.fn(),
  aggregateHistory: vi.fn(),
}));
vi.mock('../clients/staffClient.js', () => ({
  staffClient: { getEmployeeNames: vi.fn(), hasActiveShift: vi.fn() },
}));

const URL = '/api/orders/history/export';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let app;
// call() de los helpers parsea JSON; aqui hace falta el cuerpo binario
async function download(query = '', token = tokenFor('ADMIN')) {
  const res = await fetch(`${app.base}${URL}${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const type = res.headers.get('content-type') ?? '';
  const body = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, body };
}

beforeAll(async () => {
  app = await startApp();
});
afterAll(() => app.close());
beforeEach(() => {
  vi.resetAllMocks();
  aggregateHistory.mockResolvedValue({ totalSales: 30000, ordersCount: 1 });
  findHistoryForExport.mockResolvedValue([
    {
      orderId: 'aaaaaaaa-0000-4000-8000-000000000001',
      tableId: 't',
      openedBy: 'w-1',
      openedAt: new Date('2026-11-14T17:00:00Z'),
      closedAt: new Date('2026-11-14T19:00:00Z'),
      table: { tableNumber: 4 },
      payment: {
        subtotal: 30000,
        discountAmount: 0,
        total: 30000,
        paymentMethodId: 'm',
        paymentMethod: { name: 'Efectivo' },
      },
      rounds: [{ items: [{ quantity: 1 }] }],
    },
  ]);
  staffClient.getEmployeeNames.mockResolvedValue(new Map());
});

describe('acceso: solo el ADMIN', () => {
  it('sin sesion -> 401', async () => {
    expect((await download('', null)).status).toBe(401);
    expect(findHistoryForExport).not.toHaveBeenCalled();
  });

  it.each(['WAITER', 'COOK'])('un %s -> 403 y no genera nada', async (role) => {
    const res = await download('', tokenFor(role));
    expect(res.status).toBe(403);
    expect(aggregateHistory).not.toHaveBeenCalled();
  });
});

describe('GET /api/orders/history/export', () => {
  it('descarga el .xlsx con Content-Type de Excel y el nombre del rango en Content-Disposition', async () => {
    const res = await download('?from=2026-11-01&to=2026-11-14');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(XLSX);
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="ventas_2026-11-01_2026-11-14.xlsx"',
    );
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(Number(res.headers.get('content-length'))).toBe(res.body.length);
    expect(res.body.subarray(0, 2).toString()).toBe('PK'); // un .xlsx es un zip
  });

  it('no la captura GET /history/:orderId (que responderia 400 porque "export" no es UUID)', async () => {
    const res = await download();
    expect(res.status).toBe(200);
    expect(findHistoryOrder).not.toHaveBeenCalled();
  });

  it('mas de 10000 ventas -> 422 EXPORT_TOO_LARGE en JSON (formato de error del contrato)', async () => {
    aggregateHistory.mockResolvedValue({ totalSales: 1, ordersCount: 12000 });
    const res = await download('?from=2026-01-01&to=2026-11-14');
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'EXPORT_TOO_LARGE',
      details: { rows: 12000, max: 10000 },
    });
    expect(findHistoryForExport).not.toHaveBeenCalled();
  });
});

describe('validacion (400): los mismos filtros del listado, sin paginacion', () => {
  it.each([
    ['page', '?page=1'],
    ['pageSize', '?pageSize=50'],
    ['solo from', '?from=2026-11-14'],
    ['from posterior a to', '?from=2026-11-15&to=2026-11-14'],
    ['mas de 366 dias', '?from=2026-01-01&to=2027-01-02'],
    ['waiterId no UUID', '?waiterId=mesero1'],
    ['parametro desconocido', '?format=csv'],
  ])('%s', async (_label, query) => {
    const res = await download(query);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(aggregateHistory).not.toHaveBeenCalled();
  });
});
