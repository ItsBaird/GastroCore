import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../repositories/table.repository.js');

const repo = await import('../repositories/table.repository.js');

const { createTableService, listTablesService, updateTableService } =
  await import('./table.service.js');

function p2002(target) {
  const err = new Error('Unique constraint');
  err.code = 'P2002';
  err.meta = { target: [target] };
  return err;
}

function makeTable(overrides = {}) {
  return {
    tableId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    tableNumber: 1,
    qrToken: 'mock-token-base64url',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('createTableService', () => {
  it('creates a table with status-free qrToken of sufficient entropy', async () => {
    repo.createTable.mockResolvedValue(
      makeTable({ qrToken: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123456789_-' }),
    );
    const result = await createTableService({ tableNumber: 1 });
    expect(result).toHaveProperty('tableId');
    expect(result).toHaveProperty('tableNumber', 1);
    expect(result).toHaveProperty('qrToken');
    expect(result.qrToken.length).toBeGreaterThanOrEqual(22);
    expect(result.qrToken).not.toBe(result.tableId);
  });

  it('generates distinct tokens for two creations', async () => {
    const tokens = [];
    repo.createTable.mockImplementation(async (data) => {
      tokens.push(data.qrToken);
      return makeTable({ qrToken: data.qrToken, tableNumber: data.tableNumber });
    });

    await createTableService({ tableNumber: 1 });
    await createTableService({ tableNumber: 2 });
    expect(tokens[0]).not.toBe(tokens[1]);
  });

  it('throws 409 CONFLICT on duplicate table number (P2002)', async () => {
    repo.createTable.mockRejectedValue(p2002('table_number'));
    await expect(createTableService({ tableNumber: 1 })).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
    });
  });

  it('retries on qr_token collision (P2002) and succeeds', async () => {
    let calls = 0;
    repo.createTable.mockImplementation(async (data) => {
      calls++;
      if (calls === 1) throw p2002('qr_token');
      return makeTable({ qrToken: data.qrToken });
    });

    const result = await createTableService({ tableNumber: 1 });
    expect(result).toHaveProperty('qrToken');
    expect(calls).toBe(2);
  });
});

describe('updateTableService', () => {
  it('updates a table successfully', async () => {
    repo.findTableById.mockResolvedValue(makeTable());
    repo.updateTable.mockResolvedValue(makeTable({ tableNumber: 5 }));
    const result = await updateTableService('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', {
      tableNumber: 5,
    });
    expect(result.tableNumber).toBe(5);
  });

  it('throws 404 for non-existent table', async () => {
    repo.findTableById.mockResolvedValue(null);
    await expect(
      updateTableService('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', { tableNumber: 1 }),
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('throws 409 CONFLICT when number belongs to another table', async () => {
    repo.findTableById.mockResolvedValue(makeTable());
    repo.updateTable.mockRejectedValue(p2002('table_number'));
    await expect(
      updateTableService('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', { tableNumber: 2 }),
    ).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
  });

  it('allows updating with own current number (no conflict)', async () => {
    repo.findTableById.mockResolvedValue(makeTable({ tableNumber: 3 }));
    repo.updateTable.mockResolvedValue(makeTable({ tableNumber: 3 }));
    const result = await updateTableService('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', {
      tableNumber: 3,
    });
    expect(result.tableNumber).toBe(3);
  });
});

describe('listTablesService', () => {
  it('returns tables ordered by number', async () => {
    const tables = [
      makeTable({ tableNumber: 1, tableId: 'a' }),
      makeTable({ tableNumber: 2, tableId: 'b' }),
      makeTable({ tableNumber: 3, tableId: 'c' }),
    ];
    repo.findAllTablesOrderedByNumber.mockResolvedValue(tables);
    const result = await listTablesService();
    expect(result).toHaveLength(3);
    expect(result[0].tableNumber).toBe(1);
    expect(result[1].tableNumber).toBe(2);
    expect(result[2].tableNumber).toBe(3);
    result.forEach((t) => {
      expect(t).toHaveProperty('tableId');
      expect(t).toHaveProperty('tableNumber');
      expect(t).toHaveProperty('qrToken');
      expect(t).not.toHaveProperty('createdAt');
      expect(t).not.toHaveProperty('updatedAt');
    });
  });
});
