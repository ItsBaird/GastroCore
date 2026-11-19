import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listActiveWaiters } from './activeWaiters.js';
import { listEmployees, listShifts } from './staff.js';
import { listUsers } from './users.js';

vi.mock('./staff.js');
vi.mock('./users.js');

beforeEach(() => {
  vi.resetAllMocks();
  listEmployees.mockResolvedValue([
    { userId: 'w-1', fullName: 'Zoe Mesera' },
    { userId: 'w-2', fullName: 'Ana Mesera' },
    { userId: 'c-1', fullName: 'Coco Cocinero' },
  ]);
  listUsers.mockResolvedValue([
    { userId: 'w-1', email: 'zoe@x.co', role: 'WAITER', isActive: true },
    { userId: 'w-2', email: 'ana@x.co', role: 'WAITER', isActive: true },
    { userId: 'w-3', email: 'sinperfil@x.co', role: 'WAITER', isActive: true },
    { userId: 'w-4', email: 'programado@x.co', role: 'WAITER', isActive: true },
    { userId: 'w-5', email: 'inactivo@x.co', role: 'WAITER', isActive: false },
    { userId: 'c-1', email: 'coco@x.co', role: 'COOK', isActive: true },
  ]);
  listShifts.mockResolvedValue([
    { userId: 'w-1', status: 'activo' },
    { userId: 'w-2', status: 'activo' },
    { userId: 'w-3', status: 'activo' },
    { userId: 'w-4', status: 'programado' },
    { userId: 'w-5', status: 'activo' },
    { userId: 'c-1', status: 'activo' },
  ]);
});

describe('listActiveWaiters', () => {
  it('solo meseros activos con turno activo, ordenados por nombre', async () => {
    expect(await listActiveWaiters()).toEqual([
      { userId: 'w-2', name: 'Ana Mesera' },
      { userId: 'w-3', name: 'sinperfil@x.co' },
      { userId: 'w-1', name: 'Zoe Mesera' },
    ]);
  });

  it('si una de las consultas falla, falla la lista', async () => {
    listUsers.mockRejectedValue(new Error('caido'));

    await expect(listActiveWaiters()).rejects.toThrow('caido');
  });
});
