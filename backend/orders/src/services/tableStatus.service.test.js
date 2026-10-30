import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../repositories/tableStatus.repository.js');

const repo = await import('../repositories/tableStatus.repository.js');
const { listTableStatuses } = await import('./tableStatus.service.js');

function makeTable(overrides = {}) {
  return {
    tableId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    tableNumber: 1,
    qrToken: 'token-abc',
    createdAt: new Date(),
    updatedAt: new Date(),
    orders: [],
    serviceCalls: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('listTableStatuses', () => {
  it('returns libre when no open order exists', async () => {
    repo.findAllTablesWithOpenOrdersAndPendingCalls.mockResolvedValue([
      makeTable(),
    ]);
    const result = await listTableStatuses();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      tableId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      tableNumber: 1,
      status: 'libre',
      pendingCalls: [],
    });
    expect(result[0]).not.toHaveProperty('orderId');
    expect(result[0]).not.toHaveProperty('waiterId');
  });

  it('returns ocupada when order is ABIERTA', async () => {
    repo.findAllTablesWithOpenOrdersAndPendingCalls.mockResolvedValue([
      makeTable({
        orders: [{ orderId: 'order-1', waiterId: 'waiter-1', status: 'ABIERTA' }],
      }),
    ]);
    const result = await listTableStatuses();
    expect(result[0]).toMatchObject({
      status: 'ocupada',
      orderId: 'order-1',
      waiterId: 'waiter-1',
    });
  });

  it('returns en_cobro when order is EN_COBRO', async () => {
    repo.findAllTablesWithOpenOrdersAndPendingCalls.mockResolvedValue([
      makeTable({
        orders: [{ orderId: 'order-2', waiterId: 'waiter-2', status: 'EN_COBRO' }],
      }),
    ]);
    const result = await listTableStatuses();
    expect(result[0]).toMatchObject({
      status: 'en_cobro',
      orderId: 'order-2',
      waiterId: 'waiter-2',
    });
  });

  it('includes pending service calls', async () => {
    const call = {
      serviceCallId: 'sc-1',
      tableId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      type: 'call_waiter',
      status: 'pendiente',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    repo.findAllTablesWithOpenOrdersAndPendingCalls.mockResolvedValue([
      makeTable({ serviceCalls: [call] }),
    ]);
    const result = await listTableStatuses();
    expect(result[0].pendingCalls).toHaveLength(1);
    expect(result[0].pendingCalls[0]).toMatchObject({
      serviceCallId: 'sc-1',
      type: 'call_waiter',
      status: 'pendiente',
    });
  });

  it('returns tables ordered by number', async () => {
    repo.findAllTablesWithOpenOrdersAndPendingCalls.mockResolvedValue([
      makeTable({ tableId: 'a', tableNumber: 1 }),
      makeTable({ tableId: 'b', tableNumber: 2 }),
      makeTable({ tableId: 'c', tableNumber: 3 }),
    ]);
    const result = await listTableStatuses();
    expect(result.map((t) => t.tableNumber)).toEqual([1, 2, 3]);
  });
});
