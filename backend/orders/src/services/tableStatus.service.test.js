import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../repositories/tableStatus.repository.js');
vi.mock('../clients/staffClient.js');

const repo = await import('../repositories/tableStatus.repository.js');
const { staffClient } = await import('../clients/staffClient.js');
const { getTableStatus, listTableStatuses } = await import('./tableStatus.service.js');

// El repositorio ya filtra los items cancelados, asi que rounds solo trae los activos.
function makeOrder(overrides = {}) {
  return {
    orderId: 'order-1',
    waiterId: 'waiter-1',
    status: 'ABIERTA',
    rounds: [],
    ...overrides,
  };
}

function makeRounds(...counts) {
  return counts.map((count) => ({
    items: Array.from({ length: count }, (_, i) => ({ itemId: `item-${i}` })),
  }));
}

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
  staffClient.getEmployeeNames.mockResolvedValue(new Map());
});

describe('nombre del mesero', () => {
  it('agrega el nombre de quien atiende cada mesa, consultando cada mesero una vez', async () => {
    repo.findAllTablesWithOpenOrdersAndPendingCalls.mockResolvedValue([
      makeTable({ tableId: 'a', orders: [makeOrder({ waiterId: 'waiter-1' })] }),
      makeTable({ tableId: 'b', orders: [makeOrder({ waiterId: 'waiter-1' })] }),
      makeTable({ tableId: 'c' }),
    ]);
    staffClient.getEmployeeNames.mockResolvedValue(new Map([['waiter-1', 'Carlos Rojas']]));

    const result = await listTableStatuses();

    expect(staffClient.getEmployeeNames).toHaveBeenCalledWith(['waiter-1']);
    expect(result[0].waiterName).toBe('Carlos Rojas');
    expect(result[1].waiterName).toBe('Carlos Rojas');
    expect(result[2]).not.toHaveProperty('waiterName');
  });

  it('un mesero sin perfil en Staff queda con waiterName null', async () => {
    repo.findTableWithOpenOrderAndPendingCalls.mockResolvedValue(
      makeTable({ orders: [makeOrder()] }),
    );

    const result = await getTableStatus('a');

    expect(result.waiterName).toBeNull();
    expect(result.waiterId).toBe('waiter-1');
  });
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
        orders: [makeOrder({ rounds: makeRounds(2, 1) })],
      }),
    ]);
    const result = await listTableStatuses();
    expect(result[0]).toMatchObject({
      status: 'ocupada',
      orderId: 'order-1',
      waiterId: 'waiter-1',
      itemsCount: 3,
    });
  });

  it('returns en_cobro when order is EN_COBRO', async () => {
    repo.findAllTablesWithOpenOrdersAndPendingCalls.mockResolvedValue([
      makeTable({
        orders: [
          makeOrder({
            orderId: 'order-2',
            waiterId: 'waiter-2',
            status: 'EN_COBRO',
            rounds: makeRounds(4),
          }),
        ],
      }),
    ]);
    const result = await listTableStatuses();
    expect(result[0]).toMatchObject({
      status: 'en_cobro',
      orderId: 'order-2',
      waiterId: 'waiter-2',
      itemsCount: 4,
    });
  });

  it('cuenta 0 ítems cuando la mesa está abierta pero sin pedido', async () => {
    repo.findAllTablesWithOpenOrdersAndPendingCalls.mockResolvedValue([
      makeTable({ orders: [makeOrder()] }),
    ]);
    const result = await listTableStatuses();
    expect(result[0]).toMatchObject({ status: 'ocupada', itemsCount: 0 });
  });

  it('no expone itemsCount en una mesa libre', async () => {
    repo.findAllTablesWithOpenOrdersAndPendingCalls.mockResolvedValue([makeTable()]);
    const result = await listTableStatuses();
    expect(result[0]).not.toHaveProperty('itemsCount');
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

describe('getTableStatus', () => {
  it('devuelve el estado de una sola mesa con su itemsCount', async () => {
    repo.findTableWithOpenOrderAndPendingCalls.mockResolvedValue(
      makeTable({ orders: [makeOrder({ rounds: makeRounds(1, 1) })] }),
    );

    await expect(getTableStatus('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).resolves.toMatchObject({
      status: 'ocupada',
      itemsCount: 2,
    });
  });

  it('devuelve null si la mesa no existe', async () => {
    repo.findTableWithOpenOrderAndPendingCalls.mockResolvedValue(null);

    await expect(getTableStatus('no-existe')).resolves.toBeNull();
  });
});
