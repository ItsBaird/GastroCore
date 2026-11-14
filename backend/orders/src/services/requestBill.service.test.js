import { beforeEach, describe, expect, it, vi } from 'vitest';

// Con fabrica: no se carga el repositorio real (que construiria un PrismaClient)
vi.mock('../repositories/serviceCall.repository.js', () => ({
  findTableByQrToken: vi.fn(),
  createServiceCall: vi.fn(),
}));
vi.mock('../realtime/serviceCallEvents.js', () => ({ emitBillRequested: vi.fn() }));

const repo = await import('../repositories/serviceCall.repository.js');
const { emitBillRequested } = await import('../realtime/serviceCallEvents.js');
const { requestBill } = await import('./requestBill.service.js');

const TABLE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const WAITER_ID = '55555555-5555-4555-8555-555555555555';
const tableWith = (orders) => ({ tableId: TABLE_ID, tableNumber: 7, orders });
const BUSY = tableWith([{ orderId: 'o-1', waiterId: WAITER_ID, status: 'ABIERTA' }]);
const BILLING = tableWith([{ orderId: 'o-1', waiterId: WAITER_ID, status: 'EN_COBRO' }]);
const FREE = tableWith([]);

const makeCall = (over = {}) => ({
  serviceCallId: '11111111-2222-4333-8444-555555555555',
  tableId: TABLE_ID,
  type: 'request_bill',
  status: 'pendiente',
  createdAt: new Date('2026-11-14T10:00:00Z'),
  attendedAt: null,
  attendedBy: null,
  internalNote: 'no debe salir',
  ...over,
});
const prismaCode = (code) => Object.assign(new Error('x'), { code });

beforeEach(() => {
  vi.resetAllMocks();
  repo.findTableByQrToken.mockResolvedValue(BUSY);
  repo.createServiceCall.mockResolvedValue(makeCall());
});

describe('requestBill', () => {
  it('mesa ocupada: crea un llamado request_bill para la mesa del token', async () => {
    await requestBill('token-valido');
    expect(repo.findTableByQrToken).toHaveBeenCalledWith('token-valido');
    expect(repo.createServiceCall).toHaveBeenCalledWith({
      tableId: TABLE_ID,
      type: 'request_bill',
    });
  });

  it('el cliente recibe el PublicServiceCall: sin tableId, sin datos de atencion ni campos internos', async () => {
    const out = await requestBill('t');
    expect(Object.keys(out).sort()).toEqual(['createdAt', 'serviceCallId', 'status', 'type']);
    expect(out).toMatchObject({ type: 'request_bill', status: 'pendiente' });
  });

  it('avisa SOLO al mesero asignado con el llamado completo (con tableId) y el numero de mesa', async () => {
    await requestBill('t');
    expect(emitBillRequested).toHaveBeenCalledOnce();
    expect(emitBillRequested).toHaveBeenCalledWith({
      serviceCall: expect.objectContaining({
        type: 'request_bill',
        tableId: TABLE_ID,
        attendedAt: null,
      }),
      tableNumber: 7,
      waiterId: WAITER_ID,
    });
    expect(emitBillRequested.mock.calls[0][0].serviceCall).not.toHaveProperty('internalNote');
  });

  it('mesa libre -> 409 TABLE_NOT_OPEN, sin crear ni avisar', async () => {
    repo.findTableByQrToken.mockResolvedValue(FREE);
    await expect(requestBill('t')).rejects.toMatchObject({ status: 409, code: 'TABLE_NOT_OPEN' });
    expect(repo.createServiceCall).not.toHaveBeenCalled();
    expect(emitBillRequested).not.toHaveBeenCalled();
  });

  it('mesa en cobro -> 409 INVALID_TRANSITION, sin crear ni avisar', async () => {
    repo.findTableByQrToken.mockResolvedValue(BILLING);
    await expect(requestBill('t')).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
    });
    expect(repo.createServiceCall).not.toHaveBeenCalled();
    expect(emitBillRequested).not.toHaveBeenCalled();
  });

  it('ya hay una peticion pendiente (indice unico, P2002) -> 409 CONFLICT con details.type y sin avisar de nuevo', async () => {
    repo.createServiceCall.mockRejectedValue(prismaCode('P2002'));
    await expect(requestBill('t')).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
      details: { type: 'request_bill' },
    });
    expect(emitBillRequested).not.toHaveBeenCalled();
  });

  it('la mesa se borro entre la consulta y el alta (P2003) -> 404', async () => {
    repo.createServiceCall.mockRejectedValue(prismaCode('P2003'));
    await expect(requestBill('t')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('token desconocido -> 404; un token mas largo que la columna ni se consulta', async () => {
    repo.findTableByQrToken.mockResolvedValue(null);
    await expect(requestBill('x')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    repo.findTableByQrToken.mockClear();
    await expect(requestBill('a'.repeat(256))).rejects.toMatchObject({ status: 404 });
    expect(repo.findTableByQrToken).not.toHaveBeenCalled();
  });

  it('si falla el aviso en tiempo real el llamado ya guardado se responde igual', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    emitBillRequested.mockImplementation(() => {
      throw new Error('Socket.io no inicializado');
    });
    await expect(requestBill('t')).resolves.toMatchObject({ type: 'request_bill' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('un error inesperado de la base se propaga', async () => {
    const boom = new Error('db caida');
    repo.createServiceCall.mockRejectedValue(boom);
    await expect(requestBill('t')).rejects.toBe(boom);
  });
});
