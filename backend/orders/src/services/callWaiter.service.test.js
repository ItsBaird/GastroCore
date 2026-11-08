import { beforeEach, describe, expect, it, vi } from 'vitest';

// Con fabrica: no se carga el repositorio real (que construiria un PrismaClient)
vi.mock('../repositories/serviceCall.repository.js', () => ({
  findTableByQrToken: vi.fn(),
  createServiceCall: vi.fn(),
}));
vi.mock('../realtime/serviceCallEvents.js', () => ({ emitWaiterCalled: vi.fn() }));

const repo = await import('../repositories/serviceCall.repository.js');
const { emitWaiterCalled } = await import('../realtime/serviceCallEvents.js');
const { callWaiter } = await import('./callWaiter.service.js');

const TABLE = { tableId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', tableNumber: 7, orders: [] };

function makeCall(overrides = {}) {
  return {
    serviceCallId: '11111111-2222-4333-8444-555555555555',
    tableId: TABLE.tableId,
    type: 'call_waiter',
    status: 'pendiente',
    createdAt: new Date('2026-11-08T10:00:00Z'),
    attendedAt: null,
    attendedBy: null,
    internalNote: 'no debe salir',
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  repo.findTableByQrToken.mockResolvedValue(TABLE);
  repo.createServiceCall.mockResolvedValue(makeCall());
});

describe('callWaiter', () => {
  it('crea un llamado call_waiter para la mesa del token y devuelve solo los campos del contrato', async () => {
    const out = await callWaiter('token-valido');
    expect(repo.findTableByQrToken).toHaveBeenCalledWith('token-valido');
    expect(repo.createServiceCall).toHaveBeenCalledWith({
      tableId: TABLE.tableId,
      type: 'call_waiter',
    });
    expect(Object.keys(out).sort()).toEqual([
      'attendedAt',
      'attendedBy',
      'createdAt',
      'serviceCallId',
      'status',
      'tableId',
      'type',
    ]);
  });

  it('mesa libre: avisa sin mesero concreto (sala waiters) y con el numero de mesa', async () => {
    await callWaiter('t');
    expect(emitWaiterCalled).toHaveBeenCalledWith({
      serviceCall: expect.objectContaining({ type: 'call_waiter', status: 'pendiente' }),
      tableNumber: 7,
      waiterId: null,
    });
  });

  it('mesa con orden abierta: avisa al mesero de esa orden', async () => {
    repo.findTableByQrToken.mockResolvedValue({ ...TABLE, orders: [{ waiterId: 'mesero-1' }] });
    await callWaiter('t');
    expect(emitWaiterCalled.mock.calls[0][0].waiterId).toBe('mesero-1');
  });

  it('un token inexistente -> 404 NOT_FOUND y no crea ni avisa', async () => {
    repo.findTableByQrToken.mockResolvedValue(null);
    await expect(callWaiter('x')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(repo.createServiceCall).not.toHaveBeenCalled();
    expect(emitWaiterCalled).not.toHaveBeenCalled();
  });

  it.each([
    ['', 'vacio'],
    ['a'.repeat(256), 'demasiado largo'],
    [undefined, 'sin valor'],
    [123, 'no es texto'],
  ])('token %s (%s) -> 404 sin consultar la base', async (token) => {
    await expect(callWaiter(token)).rejects.toMatchObject({ status: 404 });
    expect(repo.findTableByQrToken).not.toHaveBeenCalled();
  });

  it('un token de exactamente 255 caracteres si se consulta', async () => {
    await callWaiter('a'.repeat(255));
    expect(repo.findTableByQrToken).toHaveBeenCalledOnce();
  });

  it('duplicado pendiente (P2002) -> 409 CONFLICT y no avisa', async () => {
    repo.createServiceCall.mockRejectedValue(Object.assign(new Error('x'), { code: 'P2002' }));
    await expect(callWaiter('t')).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
      details: { type: 'call_waiter' },
    });
    expect(emitWaiterCalled).not.toHaveBeenCalled();
  });

  it('mesa borrada entre la consulta y el alta (P2003) -> 404', async () => {
    repo.createServiceCall.mockRejectedValue(Object.assign(new Error('x'), { code: 'P2003' }));
    await expect(callWaiter('t')).rejects.toMatchObject({ status: 404 });
  });

  it('un error desconocido de la base se propaga sin traducir', async () => {
    const boom = new Error('db caida');
    repo.createServiceCall.mockRejectedValue(boom);
    await expect(callWaiter('t')).rejects.toBe(boom);
  });

  it('si el aviso en tiempo real falla, igual devuelve el llamado ya guardado', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    emitWaiterCalled.mockImplementation(() => {
      throw new Error('Socket.io no inicializado');
    });
    await expect(callWaiter('t')).resolves.toMatchObject({ type: 'call_waiter' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
