import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../repositories/serviceCall.repository.js');
vi.mock('../realtime/events.js');
vi.mock('./tableStatus.service.js');

const repo = await import('../repositories/serviceCall.repository.js');
const events = await import('../realtime/events.js');
const { getTableStatus } = await import('./tableStatus.service.js');
const { attendServiceCall } = await import('./attendServiceCall.service.js');

const CALL_ID = '88888888-8888-4888-8888-888888888888';
const TABLE_ID = '33333333-3333-4333-8333-333333333333';
const WAITER_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_ID = '77777777-7777-4777-8777-777777777777';

const waiter = { userId: WAITER_ID, role: 'WAITER' };
const otherWaiter = { userId: OTHER_ID, role: 'WAITER' };
const admin = { userId: OTHER_ID, role: 'ADMIN' };

const call = (over = {}) => ({
  serviceCallId: CALL_ID,
  tableId: TABLE_ID,
  type: 'call_waiter',
  status: 'pendiente',
  createdAt: new Date('2026-11-10T10:00:00Z'),
  attendedAt: null,
  attendedBy: null,
  table: { tableId: TABLE_ID, orders: [{ waiterId: WAITER_ID }] },
  ...over,
});

const attended = (over = {}) => ({
  serviceCallId: CALL_ID,
  tableId: TABLE_ID,
  type: 'call_waiter',
  status: 'atendido',
  createdAt: new Date('2026-11-10T10:00:00Z'),
  attendedAt: new Date('2026-11-10T10:02:00Z'),
  attendedBy: WAITER_ID,
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  repo.findServiceCallForAttend.mockResolvedValue(call());
  repo.markServiceCallAttended.mockResolvedValue(attended());
  getTableStatus.mockResolvedValue({ tableId: TABLE_ID, pendingCalls: [] });
});

describe('attendServiceCall', () => {
  it('el mesero asignado lo marca atendido y recibe el ServiceCall del contrato', async () => {
    const out = await attendServiceCall(CALL_ID, waiter);
    expect(repo.markServiceCallAttended).toHaveBeenCalledWith({
      serviceCallId: CALL_ID,
      attendedBy: WAITER_ID,
    });
    expect(out).toEqual({
      serviceCallId: CALL_ID,
      tableId: TABLE_ID,
      type: 'call_waiter',
      status: 'atendido',
      createdAt: new Date('2026-11-10T10:00:00Z'),
      attendedAt: new Date('2026-11-10T10:02:00Z'),
      attendedBy: WAITER_ID,
    });
  });

  it('sirve tambien para request_bill', async () => {
    repo.findServiceCallForAttend.mockResolvedValue(call({ type: 'request_bill' }));
    repo.markServiceCallAttended.mockResolvedValue(attended({ type: 'request_bill' }));
    await expect(attendServiceCall(CALL_ID, waiter)).resolves.toMatchObject({
      type: 'request_bill',
    });
  });

  it('emite table:status_changed con el estado de la mesa ya sin ese llamado', async () => {
    await attendServiceCall(CALL_ID, waiter);
    expect(getTableStatus).toHaveBeenCalledWith(TABLE_ID);
    expect(events.emitTableStatusChanged).toHaveBeenCalledOnce();
    expect(events.emitTableStatusChanged).toHaveBeenCalledWith({
      tableId: TABLE_ID,
      pendingCalls: [],
    });
  });

  it('el ADMIN puede atender el llamado de cualquier mesa', async () => {
    await expect(attendServiceCall(CALL_ID, admin)).resolves.toHaveProperty('status', 'atendido');
    expect(repo.markServiceCallAttended.mock.calls[0][0].attendedBy).toBe(OTHER_ID);
  });

  it('con la mesa ocupada o en cobro, otro mesero -> 403 y no se modifica nada', async () => {
    await expect(attendServiceCall(CALL_ID, otherWaiter)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(repo.markServiceCallAttended).not.toHaveBeenCalled();
    expect(events.emitTableStatusChanged).not.toHaveBeenCalled();
  });

  it('con la mesa libre (sin orden) cualquier mesero puede atenderlo', async () => {
    repo.findServiceCallForAttend.mockResolvedValue(
      call({ table: { tableId: TABLE_ID, orders: [] } }),
    );
    await expect(attendServiceCall(CALL_ID, otherWaiter)).resolves.toHaveProperty(
      'status',
      'atendido',
    );
  });

  it('llamado inexistente -> 404', async () => {
    repo.findServiceCallForAttend.mockResolvedValue(null);
    await expect(attendServiceCall(CALL_ID, waiter)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('ya atendido (lo cerro otro, la apertura o el pago) -> 409 INVALID_TRANSITION, sin escribir', async () => {
    repo.findServiceCallForAttend.mockResolvedValue(call({ status: 'atendido' }));
    await expect(attendServiceCall(CALL_ID, waiter)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
    });
    expect(repo.markServiceCallAttended).not.toHaveBeenCalled();
  });

  it('carrera: lo cerraron entre la lectura y la escritura (null) -> 409 y no emite nada', async () => {
    repo.markServiceCallAttended.mockResolvedValue(null);
    await expect(attendServiceCall(CALL_ID, waiter)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
    });
    expect(events.emitTableStatusChanged).not.toHaveBeenCalled();
  });

  it('si falla el aviso en tiempo real el llamado ya guardado se responde igual', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    events.emitTableStatusChanged.mockImplementation(() => {
      throw new Error('Socket.io no inicializado');
    });
    await expect(attendServiceCall(CALL_ID, waiter)).resolves.toHaveProperty('status', 'atendido');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('un error de la base se propaga', async () => {
    const boom = new Error('db caida');
    repo.markServiceCallAttended.mockRejectedValue(boom);
    await expect(attendServiceCall(CALL_ID, waiter)).rejects.toBe(boom);
  });
});
