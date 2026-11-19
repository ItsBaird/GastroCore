import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../repositories/openTable.repository.js');
vi.mock('../repositories/reassignTable.repository.js');
vi.mock('../realtime/events.js');
vi.mock('../clients/staffClient.js');
vi.mock('./tableStatus.service.js');

const openRepo = await import('../repositories/openTable.repository.js');
const repo = await import('../repositories/reassignTable.repository.js');
const events = await import('../realtime/events.js');
const { staffClient } = await import('../clients/staffClient.js');
const tableStatus = await import('./tableStatus.service.js');
const { reassignTable } = await import('./reassignTable.service.js');

const TABLE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ORDER_ID = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const WAITER_A = '11111111-1111-4111-8111-111111111111';
const WAITER_B = '22222222-2222-4222-8222-222222222222';
const ADMIN = { userId: '99999999-9999-4999-8999-999999999999', role: 'ADMIN' };

const openOrder = (overrides = {}) => ({
  orderId: ORDER_ID,
  tableId: TABLE_ID,
  openedBy: WAITER_A,
  waiterId: WAITER_A,
  status: 'ABIERTA',
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  openRepo.findTableById.mockResolvedValue({ tableId: TABLE_ID, tableNumber: 7 });
  openRepo.findOpenOrderByTable.mockResolvedValue(openOrder());
  staffClient.hasActiveShift.mockResolvedValue(true);
  repo.reassignOrderWaiter.mockResolvedValue({
    applied: true,
    order: openOrder({ waiterId: WAITER_B }),
  });
  tableStatus.getTableStatus.mockResolvedValue({ tableId: TABLE_ID, waiterId: WAITER_B });
});

describe('reassignTable', () => {
  it('cambia el mesero y conserva opened_by (atribucion de ventas)', async () => {
    const result = await reassignTable(TABLE_ID, WAITER_B, ADMIN);

    expect(result.waiterId).toBe(WAITER_B);
    expect(result.openedBy).toBe(WAITER_A);
    const args = repo.reassignOrderWaiter.mock.calls[0][0];
    expect(args).not.toHaveProperty('openedBy');
    expect(args).toMatchObject({ orderId: ORDER_ID, fromWaiterId: WAITER_A, toWaiterId: WAITER_B });
  });

  it('audita quien reasigno, la mesa y los dos meseros', async () => {
    await reassignTable(TABLE_ID, WAITER_B, ADMIN);

    expect(repo.reassignOrderWaiter.mock.calls[0][0]).toMatchObject({
      performedBy: ADMIN.userId,
      details: {
        orderId: ORDER_ID,
        tableNumber: 7,
        previousWaiterId: WAITER_A,
        newWaiterId: WAITER_B,
      },
    });
  });

  it('una mesa en cobro tambien se puede reasignar', async () => {
    openRepo.findOpenOrderByTable.mockResolvedValue(openOrder({ status: 'EN_COBRO' }));

    await expect(reassignTable(TABLE_ID, WAITER_B, ADMIN)).resolves.toMatchObject({
      waiterId: WAITER_B,
    });
  });

  it('avisa a todos los paneles despues de confirmar el cambio', async () => {
    await reassignTable(TABLE_ID, WAITER_B, ADMIN);

    expect(events.emitTableReassigned).toHaveBeenCalledWith(
      { tableId: TABLE_ID, waiterId: WAITER_B },
      { previousWaiterId: WAITER_A, newWaiterId: WAITER_B },
    );
    expect(repo.reassignOrderWaiter.mock.invocationCallOrder[0]).toBeLessThan(
      events.emitTableReassigned.mock.invocationCallOrder[0],
    );
  });

  it('una mesa inexistente responde 404', async () => {
    openRepo.findTableById.mockResolvedValue(null);

    await expect(reassignTable(TABLE_ID, WAITER_B, ADMIN)).rejects.toMatchObject({
      status: 404,
      code: 'TABLE_NOT_FOUND',
    });
  });

  it('una mesa libre responde 409 TABLE_NOT_OPEN', async () => {
    openRepo.findOpenOrderByTable.mockResolvedValue(null);

    await expect(reassignTable(TABLE_ID, WAITER_B, ADMIN)).rejects.toMatchObject({
      status: 409,
      code: 'TABLE_NOT_OPEN',
    });
  });

  it('el mismo mesero responde 409 sin consultar a Staff', async () => {
    await expect(reassignTable(TABLE_ID, WAITER_A, ADMIN)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
    });
    expect(staffClient.hasActiveShift).not.toHaveBeenCalled();
  });

  it('un destino sin turno responde 409 NO_ACTIVE_SHIFT y no cambia nada', async () => {
    staffClient.hasActiveShift.mockResolvedValue(false);

    await expect(reassignTable(TABLE_ID, WAITER_B, ADMIN)).rejects.toMatchObject({
      status: 409,
      code: 'NO_ACTIVE_SHIFT',
    });
    expect(staffClient.hasActiveShift).toHaveBeenCalledWith(WAITER_B);
    expect(repo.reassignOrderWaiter).not.toHaveBeenCalled();
  });

  it('con Staff caido se propaga el 503 y no cambia nada', async () => {
    staffClient.hasActiveShift.mockRejectedValue(
      Object.assign(new Error('caido'), { status: 503, code: 'DEPENDENCY_UNAVAILABLE' }),
    );

    await expect(reassignTable(TABLE_ID, WAITER_B, ADMIN)).rejects.toMatchObject({ status: 503 });
    expect(repo.reassignOrderWaiter).not.toHaveBeenCalled();
  });

  describe('carreras (la escritura condicional afecta 0 filas)', () => {
    beforeEach(() => {
      repo.reassignOrderWaiter.mockResolvedValue({ applied: false });
    });

    it('la orden se cerro en medio: 409 TABLE_NOT_OPEN', async () => {
      openRepo.findOpenOrderByTable.mockResolvedValueOnce(openOrder()).mockResolvedValueOnce(null);

      await expect(reassignTable(TABLE_ID, WAITER_B, ADMIN)).rejects.toMatchObject({
        status: 409,
        code: 'TABLE_NOT_OPEN',
      });
      expect(events.emitTableReassigned).not.toHaveBeenCalled();
    });

    it('otro ADMIN ya la paso a ese mismo mesero: 409', async () => {
      openRepo.findOpenOrderByTable
        .mockResolvedValueOnce(openOrder())
        .mockResolvedValueOnce(openOrder({ waiterId: WAITER_B }));

      await expect(reassignTable(TABLE_ID, WAITER_B, ADMIN)).rejects.toMatchObject({
        status: 409,
        code: 'INVALID_TRANSITION',
      });
    });

    it('otro ADMIN la paso a un tercero: 409 pidiendo reintentar', async () => {
      openRepo.findOpenOrderByTable
        .mockResolvedValueOnce(openOrder())
        .mockResolvedValueOnce(openOrder({ waiterId: ADMIN.userId }));

      await expect(reassignTable(TABLE_ID, WAITER_B, ADMIN)).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining('vuelve a intentarlo'),
      });
    });
  });

  it('si la transaccion falla (auditoria incluida) no se emite ningun evento', async () => {
    repo.reassignOrderWaiter.mockRejectedValue(new Error('audit_log insert failed'));

    await expect(reassignTable(TABLE_ID, WAITER_B, ADMIN)).rejects.toThrow(
      'audit_log insert failed',
    );
    expect(events.emitTableReassigned).not.toHaveBeenCalled();
  });
});
