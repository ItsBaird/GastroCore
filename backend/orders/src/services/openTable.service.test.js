import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../repositories/openTable.repository.js');
vi.mock('../realtime/events.js');
vi.mock('../clients/staffClient.js');
vi.mock('./tableStatus.service.js');

const repo = await import('../repositories/openTable.repository.js');
const events = await import('../realtime/events.js');
const { staffClient } = await import('../clients/staffClient.js');
const tableStatus = await import('./tableStatus.service.js');
const { openTable } = await import('./openTable.service.js');

const TABLE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const USER_ID = '11111111-2222-3333-4444-555555555555';

function makeTable(overrides = {}) {
  return {
    tableId: TABLE_ID,
    tableNumber: 3,
    qrToken: 'token-abc',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  events.emitTableStatusChanged.mockImplementation(() => {});
  staffClient.hasActiveShift.mockResolvedValue(true);
});

describe('turno activo', () => {
  beforeEach(() => {
    repo.findTableById.mockResolvedValue(makeTable());
    repo.findOpenOrderByTable.mockResolvedValue(null);
  });

  it('sin turno activo responde 409 NO_ACTIVE_SHIFT y no crea la orden', async () => {
    staffClient.hasActiveShift.mockResolvedValue(false);

    await expect(openTable(TABLE_ID, USER_ID)).rejects.toMatchObject({
      status: 409,
      code: 'NO_ACTIVE_SHIFT',
    });

    expect(staffClient.hasActiveShift).toHaveBeenCalledWith(USER_ID);
    expect(repo.createOrder).not.toHaveBeenCalled();
    expect(events.emitTableStatusChanged).not.toHaveBeenCalled();
  });

  it('si Staff no responde se propaga el 503 y no crea la orden', async () => {
    staffClient.hasActiveShift.mockRejectedValue(
      Object.assign(new Error('caido'), { status: 503, code: 'DEPENDENCY_UNAVAILABLE' }),
    );

    await expect(openTable(TABLE_ID, USER_ID)).rejects.toMatchObject({ status: 503 });
    expect(repo.createOrder).not.toHaveBeenCalled();
  });

  it('dos meseros a la vez: el indice unico se traduce a TABLE_ALREADY_OPEN', async () => {
    repo.createOrder.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

    await expect(openTable(TABLE_ID, USER_ID)).rejects.toMatchObject({
      status: 409,
      code: 'TABLE_ALREADY_OPEN',
    });
  });
});

describe('openTable', () => {
  it('throws 404 when table does not exist', async () => {
    repo.findTableById.mockResolvedValue(null);

    await expect(openTable(TABLE_ID, USER_ID)).rejects.toMatchObject({
      status: 404,
      code: 'TABLE_NOT_FOUND',
    });
  });

  it('throws 409 when table already has an open order', async () => {
    repo.findTableById.mockResolvedValue(makeTable());
    repo.findOpenOrderByTable.mockResolvedValue({ orderId: 'existing', status: 'ABIERTA' });

    await expect(openTable(TABLE_ID, USER_ID)).rejects.toMatchObject({
      status: 409,
      code: 'TABLE_ALREADY_OPEN',
    });
  });

  it('creates an order and returns it', async () => {
    const order = {
      orderId: 'new-order-id',
      tableId: TABLE_ID,
      waiterId: USER_ID,
      status: 'ABIERTA',
      openedAt: new Date(),
    };
    repo.findTableById.mockResolvedValue(makeTable());
    repo.findOpenOrderByTable.mockResolvedValue(null);
    repo.createOrder.mockResolvedValue(order);

    const result = await openTable(TABLE_ID, USER_ID);

    expect(result).toEqual(order);
    expect(repo.createOrder).toHaveBeenCalledWith({
      tableId: TABLE_ID,
      openedBy: USER_ID,
      waiterId: USER_ID,
    });
  });

  it('emits table:status_changed after creating the order', async () => {
    const table = makeTable();
    const order = {
      orderId: 'new-order-id',
      tableId: TABLE_ID,
      waiterId: USER_ID,
      status: 'ABIERTA',
      openedAt: new Date(),
    };
    repo.findTableById.mockResolvedValue(table);
    repo.findOpenOrderByTable.mockResolvedValue(null);
    repo.createOrder.mockResolvedValue(order);
    const status = {
      tableId: TABLE_ID,
      tableNumber: 3,
      status: 'ocupada',
      orderId: 'new-order-id',
      waiterId: USER_ID,
      waiterName: 'Carlos Rojas',
      itemsCount: 0,
      pendingCalls: [],
    };
    tableStatus.getTableStatus.mockResolvedValue(status);

    await openTable(TABLE_ID, USER_ID);

    expect(tableStatus.getTableStatus).toHaveBeenCalledWith(TABLE_ID);
    expect(events.emitTableStatusChanged).toHaveBeenCalledWith(status);
  });

  it('does not emit event when table is not found', async () => {
    repo.findTableById.mockResolvedValue(null);

    await expect(openTable(TABLE_ID, USER_ID)).rejects.toThrow();
    expect(events.emitTableStatusChanged).not.toHaveBeenCalled();
  });

  it('does not emit event when table already has open order', async () => {
    repo.findTableById.mockResolvedValue(makeTable());
    repo.findOpenOrderByTable.mockResolvedValue({ orderId: 'x', status: 'ABIERTA' });

    await expect(openTable(TABLE_ID, USER_ID)).rejects.toThrow();
    expect(events.emitTableStatusChanged).not.toHaveBeenCalled();
  });
});
