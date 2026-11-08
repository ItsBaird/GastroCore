import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./events.js', () => ({ getIo: vi.fn() }));

const { getIo } = await import('./events.js');
const { emitWaiterCalled } = await import('./serviceCallEvents.js');

const SERVICE_CALL = {
  serviceCallId: '11111111-2222-4333-8444-555555555555',
  tableId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  type: 'call_waiter',
  status: 'pendiente',
  createdAt: new Date('2026-11-08T10:00:00Z'),
  attendedAt: null,
  attendedBy: null,
};

let io;
beforeEach(() => {
  vi.resetAllMocks();
  const emit = vi.fn();
  io = { to: vi.fn(() => ({ emit })), emit };
  getIo.mockReturnValue(io);
});

describe('emitWaiterCalled', () => {
  it('mesa libre (sin mesero): emite waiter:called a la sala "waiters"', () => {
    emitWaiterCalled({ serviceCall: SERVICE_CALL, tableNumber: 4, waiterId: null });
    expect(io.to).toHaveBeenCalledOnce();
    expect(io.to).toHaveBeenCalledWith('waiters');
    expect(io.emit).toHaveBeenCalledWith('waiter:called', { ...SERVICE_CALL, tableNumber: 4 });
  });

  it('mesa ocupada: emite solo a waiter:{id}, nunca a "waiters"', () => {
    emitWaiterCalled({ serviceCall: SERVICE_CALL, tableNumber: 4, waiterId: 'mesero-9' });
    expect(io.to).toHaveBeenCalledOnce();
    expect(io.to).toHaveBeenCalledWith('waiter:mesero-9');
    expect(io.to).not.toHaveBeenCalledWith('waiters');
  });

  it('el payload es el ServiceCall del contrato mas tableNumber, sin inventar otros campos', () => {
    emitWaiterCalled({ serviceCall: SERVICE_CALL, tableNumber: 12, waiterId: null });
    const payload = io.emit.mock.calls[0][1];
    expect(Object.keys(payload).sort()).toEqual([
      'attendedAt',
      'attendedBy',
      'createdAt',
      'serviceCallId',
      'status',
      'tableId',
      'tableNumber',
      'type',
    ]);
  });

  it('si Socket.io no esta inicializado el error sale (el servicio lo captura y no rompe la peticion)', () => {
    getIo.mockImplementation(() => {
      throw new Error('Socket.io no inicializado');
    });
    expect(() =>
      emitWaiterCalled({ serviceCall: SERVICE_CALL, tableNumber: 1, waiterId: null }),
    ).toThrow(/Socket.io/);
  });
});
