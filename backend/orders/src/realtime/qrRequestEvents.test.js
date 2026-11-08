import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./events.js', () => ({ getIo: vi.fn() }));

const { getIo } = await import('./events.js');
const { emitQrRequestCreated } = await import('./qrRequestEvents.js');

const QR_REQUEST = {
  qrRequestId: '11111111-2222-4333-8444-555555555555',
  orderId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  status: 'pendiente',
  createdAt: new Date('2026-11-08T10:00:00Z'),
  resolvedAt: null,
  resolvedBy: null,
  items: [{ productId: 'p-1', quantity: 2, note: 'sin sal' }],
};

let io;
beforeEach(() => {
  vi.resetAllMocks();
  const emit = vi.fn();
  io = { to: vi.fn(() => ({ emit })), emit };
  getIo.mockReturnValue(io);
});

describe('emitQrRequestCreated', () => {
  it('emite qr_request:created SOLO a la sala del mesero asignado (waiter:{id})', () => {
    emitQrRequestCreated({ qrRequest: QR_REQUEST, tableNumber: 4, waiterId: 'mesero-9' });
    expect(io.to).toHaveBeenCalledOnce();
    expect(io.to).toHaveBeenCalledWith('waiter:mesero-9');
    expect(io.to).not.toHaveBeenCalledWith('waiters');
    expect(io.emit).toHaveBeenCalledWith('qr_request:created', { ...QR_REQUEST, tableNumber: 4 });
  });

  it('el payload es la QrRequest del contrato mas tableNumber, sin inventar otros campos', () => {
    emitQrRequestCreated({ qrRequest: QR_REQUEST, tableNumber: 12, waiterId: 'm' });
    const payload = io.emit.mock.calls[0][1];
    expect(Object.keys(payload).sort()).toEqual([
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

  it('si Socket.io no esta inicializado el error sale (el servicio lo captura y no rompe la peticion)', () => {
    getIo.mockImplementation(() => {
      throw new Error('Socket.io no inicializado');
    });
    expect(() =>
      emitQrRequestCreated({ qrRequest: QR_REQUEST, tableNumber: 1, waiterId: 'm' }),
    ).toThrow(/Socket.io/);
  });
});
