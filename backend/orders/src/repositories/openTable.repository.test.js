// Abrir la mesa y atender sus llamados pendientes van en la misma transaccion (contrato de /open, GC-30).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tx = {
  order: { create: vi.fn() },
  serviceCall: { updateMany: vi.fn() },
};
const prisma = { $transaction: vi.fn((fn) => fn(tx)) };
vi.mock('../config/prisma.js', () => ({ prisma }));

const { createOrder } = await import('./openTable.repository.js');

const OPENED_AT = new Date('2026-11-09T19:00:00Z');
const ORDER = {
  orderId: 'o1',
  tableId: 't1',
  waiterId: 'w1',
  status: 'ABIERTA',
  openedAt: OPENED_AT,
};

beforeEach(() => {
  vi.resetAllMocks();
  prisma.$transaction.mockImplementation((fn) => fn(tx));
  tx.order.create.mockResolvedValue(ORDER);
  tx.serviceCall.updateMany.mockResolvedValue({ count: 2 });
});

describe('createOrder', () => {
  it('crea la orden y marca atendidos los llamados pendientes de la mesa por quien abre', async () => {
    await expect(createOrder({ tableId: 't1', openedBy: 'w1', waiterId: 'w1' })).resolves.toEqual(
      ORDER,
    );

    expect(tx.order.create.mock.calls[0][0].data).toEqual({
      tableId: 't1',
      openedBy: 'w1',
      waiterId: 'w1',
      status: 'ABIERTA',
    });
    // Los dos tipos (call_waiter y request_bill): el filtro es solo por mesa y estado.
    // attended_at = opened_at (CHECK chk_service_calls_resolution exige by y at juntos)
    expect(tx.serviceCall.updateMany).toHaveBeenCalledWith({
      where: { tableId: 't1', status: 'pendiente' },
      data: { status: 'atendido', attendedBy: 'w1', attendedAt: OPENED_AT },
    });
  });

  it('si la orden no se crea (P2002, otro mesero la abrio) no toca los llamados', async () => {
    const conflict = Object.assign(new Error('unique'), { code: 'P2002' });
    tx.order.create.mockRejectedValue(conflict);

    await expect(createOrder({ tableId: 't1', openedBy: 'w1', waiterId: 'w1' })).rejects.toBe(
      conflict,
    );
    expect(tx.serviceCall.updateMany).not.toHaveBeenCalled();
  });

  it('si falla la actualizacion de llamados el error sale de la transaccion (no queda la orden)', async () => {
    tx.serviceCall.updateMany.mockRejectedValue(new Error('chk_service_calls_resolution'));

    await expect(createOrder({ tableId: 't1', openedBy: 'w1', waiterId: 'w1' })).rejects.toThrow(
      'chk_service_calls_resolution',
    );
  });
});
