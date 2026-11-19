import { beforeEach, describe, expect, it, vi } from 'vitest';

// Con fabrica: no se cargan los repositorios reales (construirian un PrismaClient)
vi.mock('../repositories/serviceCall.repository.js', () => ({ findTableByQrToken: vi.fn() }));
vi.mock('../repositories/qrRequest.repository.js', () => ({
  countPendingQrRequests: vi.fn(),
  createQrRequestWithItems: vi.fn(),
}));
vi.mock('../clients/catalogClient.js', () => ({ catalogClient: { getProductsByIds: vi.fn() } }));
vi.mock('../realtime/qrRequestEvents.js', () => ({ emitQrRequestCreated: vi.fn() }));

const { findTableByQrToken } = await import('../repositories/serviceCall.repository.js');
const { countPendingQrRequests, createQrRequestWithItems } =
  await import('../repositories/qrRequest.repository.js');
const { catalogClient } = await import('../clients/catalogClient.js');
const { emitQrRequestCreated } = await import('../realtime/qrRequestEvents.js');
const { MAX_PENDING_PER_ORDER, requestOrder } = await import('./requestOrder.service.js');

const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORDER = { orderId: 'o-1', waiterId: 'mesero-1', status: 'ABIERTA' };
const TABLE = { tableId: 't-1', tableNumber: 9, orders: [ORDER] };
const ITEMS = [
  { productId: P1, quantity: 2, note: 'sin sal' },
  { productId: P2, quantity: 1 },
];

beforeEach(() => {
  vi.resetAllMocks();
  findTableByQrToken.mockResolvedValue(TABLE);
  countPendingQrRequests.mockResolvedValue(0);
  catalogClient.getProductsByIds.mockResolvedValue([
    { productId: P1, name: 'Pizza', price: 28000, isAvailable: true },
    { productId: P2, name: 'Limonada', price: 7000, isAvailable: true },
  ]);
  createQrRequestWithItems.mockResolvedValue({
    qrRequestId: 'r-1',
    orderId: 'o-1',
    status: 'pendiente',
    createdAt: new Date('2026-11-08T10:00:00Z'),
    resolvedAt: null,
    resolvedBy: null,
  });
});

describe('requestOrder', () => {
  it('crea la solicitud de la orden abierta y devuelve la QrRequest del contrato', async () => {
    const out = await requestOrder('tok', ITEMS);
    expect(createQrRequestWithItems).toHaveBeenCalledWith({ orderId: 'o-1', items: ITEMS });
    expect(out).toEqual({
      qrRequestId: 'r-1',
      orderId: 'o-1',
      status: 'pendiente',
      createdAt: new Date('2026-11-08T10:00:00Z'),
      resolvedAt: null,
      resolvedBy: null,
      items: [
        { productId: P1, quantity: 2, note: 'sin sal' },
        { productId: P2, quantity: 1 },
      ],
    });
  });

  it('avisa al mesero asignado de la orden con el numero de mesa', async () => {
    await requestOrder('tok', ITEMS);
    expect(emitQrRequestCreated).toHaveBeenCalledWith({
      qrRequest: expect.objectContaining({ qrRequestId: 'r-1', status: 'pendiente' }),
      tableNumber: 9,
      waiterId: 'mesero-1',
    });
  });

  it('consulta el catalogo una sola vez con los ids sin repetir', async () => {
    await requestOrder('tok', [...ITEMS, { productId: P1, quantity: 1 }]);
    expect(catalogClient.getProductsByIds).toHaveBeenCalledTimes(1);
    expect(catalogClient.getProductsByIds).toHaveBeenCalledWith([P1, P2]);
  });

  it('mesa libre -> 409 TABLE_NOT_OPEN, antes de tocar el catalogo o la base', async () => {
    findTableByQrToken.mockResolvedValue({ ...TABLE, orders: [] });
    await expect(requestOrder('tok', ITEMS)).rejects.toMatchObject({
      status: 409,
      code: 'TABLE_NOT_OPEN',
    });
    expect(countPendingQrRequests).not.toHaveBeenCalled();
    expect(catalogClient.getProductsByIds).not.toHaveBeenCalled();
  });

  it('mesa en cobro -> 409 INVALID_TRANSITION', async () => {
    findTableByQrToken.mockResolvedValue({ ...TABLE, orders: [{ ...ORDER, status: 'EN_COBRO' }] });
    await expect(requestOrder('tok', ITEMS)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
    });
  });

  it('token inexistente o invalido -> 404', async () => {
    findTableByQrToken.mockResolvedValue(null);
    await expect(requestOrder('x', ITEMS)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
    await expect(requestOrder('a'.repeat(256), ITEMS)).rejects.toMatchObject({ status: 404 });
  });

  it(`el tope es ${MAX_PENDING_PER_ORDER} pendientes: con ese numero rechaza, con uno menos acepta`, async () => {
    countPendingQrRequests.mockResolvedValue(MAX_PENDING_PER_ORDER);
    await expect(requestOrder('tok', ITEMS)).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
      details: { pending: MAX_PENDING_PER_ORDER },
    });
    countPendingQrRequests.mockResolvedValue(MAX_PENDING_PER_ORDER - 1);
    await expect(requestOrder('tok', ITEMS)).resolves.toMatchObject({ status: 'pendiente' });
  });

  it('producto desconocido -> 400 con la ruta de la linea; no crea ni avisa', async () => {
    catalogClient.getProductsByIds.mockResolvedValue([
      { productId: P1, name: 'Pizza', price: 1, isAvailable: true },
    ]);
    const err = await requestOrder('tok', ITEMS).catch((e) => e);
    expect(err).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(err.details.fields).toEqual([
      { path: 'items.1.productId', message: 'El producto no existe' },
    ]);
    expect(createQrRequestWithItems).not.toHaveBeenCalled();
    expect(emitQrRequestCreated).not.toHaveBeenCalled();
  });

  it('producto agotado -> 409 CONFLICT con su nombre, sin repetirlo aunque venga en dos lineas', async () => {
    catalogClient.getProductsByIds.mockResolvedValue([
      { productId: P1, name: 'Pizza', price: 1, isAvailable: false },
      { productId: P2, name: 'Limonada', price: 1, isAvailable: true },
    ]);
    const err = await requestOrder('tok', [...ITEMS, { productId: P1, quantity: 3 }]).catch(
      (e) => e,
    );
    expect(err).toMatchObject({ status: 409, code: 'CONFLICT' });
    expect(err.details.unavailable).toEqual([{ productId: P1, name: 'Pizza' }]);
    expect(createQrRequestWithItems).not.toHaveBeenCalled();
  });

  it('el error del catalogo (503) se propaga y no crea nada', async () => {
    const down = Object.assign(new Error('x'), { status: 503, code: 'DEPENDENCY_UNAVAILABLE' });
    catalogClient.getProductsByIds.mockRejectedValue(down);
    await expect(requestOrder('tok', ITEMS)).rejects.toBe(down);
    expect(createQrRequestWithItems).not.toHaveBeenCalled();
  });

  it('orden cerrada entre la consulta y el alta (P2003) -> 404; otro error se propaga tal cual', async () => {
    createQrRequestWithItems.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'P2003' }),
    );
    await expect(requestOrder('tok', ITEMS)).rejects.toMatchObject({ status: 404 });
    const boom = new Error('db caida');
    createQrRequestWithItems.mockRejectedValueOnce(boom);
    await expect(requestOrder('tok', ITEMS)).rejects.toBe(boom);
  });

  it('si falla el aviso en tiempo real devuelve igual la solicitud guardada', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    emitQrRequestCreated.mockImplementation(() => {
      throw new Error('Socket.io no inicializado');
    });
    await expect(requestOrder('tok', ITEMS)).resolves.toMatchObject({ qrRequestId: 'r-1' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
