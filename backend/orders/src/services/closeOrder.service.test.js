import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../repositories/bill.repository.js', () => ({ findOrderForBill: vi.fn() }));
vi.mock('../repositories/closeOrder.repository.js', () => ({ closeOrderWithoutPayment: vi.fn() }));
vi.mock('../realtime/events.js', () => ({
  emitOrderUpdated: vi.fn(),
  emitTableStatusChanged: vi.fn(),
}));
vi.mock('./tableStatus.service.js', () => ({ getTableStatus: vi.fn() }));

const billRepo = await import('../repositories/bill.repository.js');
const closeRepo = await import('../repositories/closeOrder.repository.js');
const events = await import('../realtime/events.js');
const tableStatus = await import('./tableStatus.service.js');
const { closeOrder } = await import('./closeOrder.service.js');

const ADMIN = { userId: 'admin-1', role: 'ADMIN', permissions: [] };
const WAITER = { userId: 'waiter-1', role: 'WAITER', permissions: [] };
const OTHER = { userId: 'waiter-2', role: 'WAITER', permissions: [] };
const CLOSED_AT = new Date('2026-11-26T20:00:00Z');

const item = (status, name = 'Pizza') => ({
  itemId: `i-${status}`,
  productNameSnapshot: name,
  status,
});
const order = (overrides = {}) => ({
  orderId: 'o-1',
  tableId: 't-1',
  waiterId: 'waiter-1',
  status: 'ABIERTA',
  table: { tableId: 't-1', tableNumber: 4 },
  rounds: [],
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  closeRepo.closeOrderWithoutPayment.mockResolvedValue({
    closedAt: CLOSED_AT,
    rejectedQrRequests: 0,
    attendedServiceCalls: 0,
  });
  tableStatus.getTableStatus.mockResolvedValue({ tableId: 't-1', status: 'libre' });
});

describe('closeOrder: cerrar sin cobro una mesa abierta por error', () => {
  it('mesa abierta sin productos: se cierra, avisa y devuelve el resultado', async () => {
    billRepo.findOrderForBill.mockResolvedValue(order());
    closeRepo.closeOrderWithoutPayment.mockResolvedValue({
      closedAt: CLOSED_AT,
      rejectedQrRequests: 1,
      attendedServiceCalls: 2,
    });

    const result = await closeOrder('o-1', ADMIN);

    expect(result).toEqual({
      orderId: 'o-1',
      tableNumber: 4,
      status: 'CERRADA',
      closedAt: CLOSED_AT,
      rejectedQrRequests: 1,
      attendedServiceCalls: 2,
    });
    expect(closeRepo.closeOrderWithoutPayment).toHaveBeenCalledWith({
      orderId: 'o-1',
      tableId: 't-1',
      userId: 'admin-1',
      auditDetails: { tableNumber: 4, waiterId: 'waiter-1' },
    });
    expect(events.emitTableStatusChanged).toHaveBeenCalledWith({ tableId: 't-1', status: 'libre' });
    expect(events.emitOrderUpdated).toHaveBeenCalledWith(
      { orderId: 'o-1', tableNumber: 4, status: 'CERRADA', discountAmount: 0 },
      'waiter-1',
    );
  });

  it('con todos los productos cancelados tambien se puede cerrar', async () => {
    billRepo.findOrderForBill.mockResolvedValue(
      order({ rounds: [{ items: [item('cancelado'), item('cancelado', 'Agua')] }] }),
    );

    await expect(closeOrder('o-1', ADMIN)).resolves.toMatchObject({ status: 'CERRADA' });
  });

  it.each(['pendiente', 'en_preparacion', 'listo', 'entregado'])(
    'con un producto %s: 409 y la lista de lo que hay que anular, sin cerrar',
    async (status) => {
      billRepo.findOrderForBill.mockResolvedValue(
        order({ rounds: [{ items: [item('cancelado', 'Agua'), item(status)] }] }),
      );

      const err = await closeOrder('o-1', ADMIN).catch((e) => e);

      expect(err.status).toBe(409);
      expect(err.code).toBe('INVALID_TRANSITION');
      expect(err.details.activeItems).toEqual([
        { itemId: `i-${status}`, productName: 'Pizza', status },
      ]);
      expect(closeRepo.closeOrderWithoutPayment).not.toHaveBeenCalled();
    },
  );

  it('en cobro: 409 que pide cancelar el cobro primero', async () => {
    billRepo.findOrderForBill.mockResolvedValue(order({ status: 'EN_COBRO' }));

    await expect(closeOrder('o-1', ADMIN)).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/cancela el cobro/),
    });
  });

  it('ya cerrada: 409', async () => {
    billRepo.findOrderForBill.mockResolvedValue(order({ status: 'CERRADA' }));

    await expect(closeOrder('o-1', ADMIN)).rejects.toMatchObject({
      status: 409,
      message: 'La mesa ya está cerrada',
    });
  });

  it('el mesero asignado tambien puede cerrar su mesa vacia', async () => {
    billRepo.findOrderForBill.mockResolvedValue(order());

    await expect(closeOrder('o-1', WAITER)).resolves.toMatchObject({ status: 'CERRADA' });
    expect(closeRepo.closeOrderWithoutPayment).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'waiter-1' }),
    );
  });

  it('otro mesero: 403 sin cerrar', async () => {
    billRepo.findOrderForBill.mockResolvedValue(order());

    await expect(closeOrder('o-1', OTHER)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(closeRepo.closeOrderWithoutPayment).not.toHaveBeenCalled();
  });

  it('orden inexistente: 404', async () => {
    billRepo.findOrderForBill.mockResolvedValue(null);

    await expect(closeOrder('o-1', ADMIN)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('entra una ronda entre la lectura y la escritura: explica con el estado real', async () => {
    billRepo.findOrderForBill
      .mockResolvedValueOnce(order())
      .mockResolvedValueOnce(order({ rounds: [{ items: [item('pendiente')] }] }));
    closeRepo.closeOrderWithoutPayment.mockResolvedValue(null);

    const err = await closeOrder('o-1', ADMIN).catch((e) => e);

    expect(err.status).toBe(409);
    expect(err.details.activeItems).toHaveLength(1);
    expect(events.emitTableStatusChanged).not.toHaveBeenCalled();
  });

  it('si falla el aviso en tiempo real, la mesa queda cerrada igual', async () => {
    billRepo.findOrderForBill.mockResolvedValue(order());
    tableStatus.getTableStatus.mockRejectedValue(new Error('socket caido'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(closeOrder('o-1', ADMIN)).resolves.toMatchObject({ status: 'CERRADA' });
    spy.mockRestore();
  });
});
