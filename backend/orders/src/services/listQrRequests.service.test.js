import { beforeEach, describe, expect, it, vi } from 'vitest';

// Con fabrica: no se carga el repositorio real (construiria un PrismaClient)
vi.mock('../repositories/qrRequest.repository.js', () => ({ findPendingQrRequests: vi.fn() }));

const { findPendingQrRequests } = await import('../repositories/qrRequest.repository.js');
const { listPendingQrRequests } = await import('./listQrRequests.service.js');

const WAITER = { userId: 'mesero-1', role: 'WAITER', permissions: [] };
const ADMIN = { userId: 'admin-1', role: 'ADMIN', permissions: [] };

const row = (over = {}) => ({
  qrRequestId: 'r-1',
  orderId: 'o-1',
  status: 'pendiente',
  createdAt: new Date('2026-11-08T10:00:00Z'),
  resolvedAt: null,
  resolvedBy: null,
  items: [
    { qrRequestItemId: 'i-1', productId: 'p-1', quantity: 2, note: 'sin sal' },
    { qrRequestItemId: 'i-2', productId: 'p-2', quantity: 1, note: null },
  ],
  order: { table: { tableNumber: 9 } },
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  findPendingQrRequests.mockResolvedValue([row()]);
});

describe('listPendingQrRequests', () => {
  it('un mesero pide solo las suyas', async () => {
    await listPendingQrRequests(WAITER);
    expect(findPendingQrRequests).toHaveBeenCalledWith({ waiterId: 'mesero-1' });
  });

  it('el ADMIN pide todas', async () => {
    await listPendingQrRequests(ADMIN);
    expect(findPendingQrRequests).toHaveBeenCalledWith({ waiterId: undefined });
  });

  it('devuelve la QrRequest del contrato mas tableNumber; la nota solo si existe', async () => {
    const [out] = await listPendingQrRequests(WAITER);
    expect(out).toEqual({
      qrRequestId: 'r-1',
      orderId: 'o-1',
      status: 'pendiente',
      createdAt: new Date('2026-11-08T10:00:00Z'),
      resolvedAt: null,
      resolvedBy: null,
      items: [
        { productId: 'p-1', quantity: 2, note: 'sin sal' },
        { productId: 'p-2', quantity: 1 },
      ],
      tableNumber: 9,
    });
  });

  it('tiene exactamente los mismos campos que el payload del evento qr_request:created', async () => {
    const [out] = await listPendingQrRequests(WAITER);
    expect(Object.keys(out).sort()).toEqual([
      'createdAt',
      'items',
      'orderId',
      'qrRequestId',
      'resolvedAt',
      'resolvedBy',
      'status',
      'tableNumber',
    ]);
  });

  it('sin solicitudes devuelve []; conserva el orden recibido', async () => {
    findPendingQrRequests.mockResolvedValue([]);
    expect(await listPendingQrRequests(WAITER)).toEqual([]);
    findPendingQrRequests.mockResolvedValue([row({ qrRequestId: 'a' }), row({ qrRequestId: 'b' })]);
    expect((await listPendingQrRequests(WAITER)).map((r) => r.qrRequestId)).toEqual(['a', 'b']);
  });

  it('un error de la base se propaga sin traducir', async () => {
    const boom = new Error('db caida');
    findPendingQrRequests.mockRejectedValue(boom);
    await expect(listPendingQrRequests(WAITER)).rejects.toBe(boom);
  });
});
