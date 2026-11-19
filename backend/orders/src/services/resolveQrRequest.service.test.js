import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../repositories/qrRequest.repository.js');
vi.mock('../realtime/events.js');
vi.mock('../clients/catalogClient.js', () => ({ catalogClient: { getProductsByIds: vi.fn() } }));
vi.mock('./tableStatus.service.js');

const repo = await import('../repositories/qrRequest.repository.js');
const events = await import('../realtime/events.js');
const { catalogClient } = await import('../clients/catalogClient.js');
const { getTableStatus } = await import('./tableStatus.service.js');
const { confirmQrRequest, rejectQrRequest } = await import('./resolveQrRequest.service.js');

const REQ_ID = '66666666-6666-4666-8666-666666666666';
const ORDER_ID = '44444444-4444-4444-8444-444444444444';
const WAITER_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_ID = '77777777-7777-4777-8777-777777777777';
const P1 = '00000000-0000-4000-a000-000000000001';
const P2 = '00000000-0000-4000-a000-000000000002';
const P_OFF = '00000000-0000-4000-a000-000000000005';

const waiter = { userId: WAITER_ID, role: 'WAITER' };
const otherWaiter = { userId: OTHER_ID, role: 'WAITER' };
const admin = { userId: OTHER_ID, role: 'ADMIN' };

const request = (over = {}) => ({
  qrRequestId: REQ_ID,
  orderId: ORDER_ID,
  status: 'pendiente',
  createdAt: new Date('2026-11-08T10:00:00Z'),
  resolvedAt: null,
  resolvedBy: null,
  items: [
    { qrRequestItemId: 'i1', productId: P1, quantity: 2, note: 'sin sal' },
    { qrRequestItemId: 'i2', productId: P2, quantity: 1, note: null },
  ],
  order: {
    orderId: ORDER_ID,
    tableId: 'table-1',
    status: 'ABIERTA',
    waiterId: WAITER_ID,
    table: { tableNumber: 7 },
  },
  ...over,
});

const catalog = (entries) =>
  entries.map(([productId, name, price, isAvailable = true]) => ({
    productId,
    name,
    price,
    isAvailable,
  }));

const roundFrom = (items) => ({
  roundId: 'round-1',
  orderId: ORDER_ID,
  source: 'QR',
  qrRequestId: REQ_ID,
  createdBy: WAITER_ID,
  createdAt: new Date('2026-11-08T10:05:00Z'),
  items: items.map((it, i) => ({
    itemId: `it-${i}`,
    roundId: 'round-1',
    productId: it.productId,
    productNameSnapshot: it.productName,
    unitPriceSnapshot: it.unitPrice,
    quantity: it.quantity,
    note: it.note ?? null,
    status: 'pendiente',
  })),
});

beforeEach(() => {
  vi.resetAllMocks();
  repo.findQrRequestForResolution.mockResolvedValue(request());
  catalogClient.getProductsByIds.mockResolvedValue(
    catalog([
      [P1, 'Pizza', 28000],
      [P2, 'Pasta', 25000],
    ]),
  );
  repo.confirmQrRequestWithRound.mockImplementation(async ({ items }) => roundFrom(items));
  getTableStatus.mockResolvedValue({ tableId: 'table-1' });
});

describe('confirmQrRequest', () => {
  it('crea la ronda QR con el snapshot de precios tomado ahora (R3) y la deja ligada a la solicitud', async () => {
    const out = await confirmQrRequest(REQ_ID, undefined, waiter);

    expect(repo.confirmQrRequestWithRound).toHaveBeenCalledWith({
      qrRequestId: REQ_ID,
      orderId: ORDER_ID,
      resolvedBy: WAITER_ID,
      items: [
        { productId: P1, productName: 'Pizza', unitPrice: 28000, quantity: 2, note: 'sin sal' },
        { productId: P2, productName: 'Pasta', unitPrice: 25000, quantity: 1, note: null },
      ],
    });
    expect(out.round).toMatchObject({
      roundId: 'round-1',
      source: 'QR',
      qrRequestId: REQ_ID,
      createdBy: WAITER_ID,
    });
    expect(out.round.items).toHaveLength(2);
    expect(out.round.items[0]).toMatchObject({ productName: 'Pizza', unitPrice: 28000 });
    expect(out).not.toHaveProperty('unavailable');
  });

  it('avisa a cocina (round:created con la mesa) y refresca el estado de la mesa', async () => {
    await confirmQrRequest(REQ_ID, undefined, waiter);
    expect(events.emitRoundCreated).toHaveBeenCalledOnce();
    expect(events.emitRoundCreated.mock.calls[0][0]).toMatchObject({
      roundId: 'round-1',
      tableNumber: 7,
      source: 'QR',
    });
    expect(getTableStatus).toHaveBeenCalledWith('table-1');
    expect(events.emitTableStatusChanged).toHaveBeenCalledWith({ tableId: 'table-1' });
  });

  it('con items en el cuerpo, el mesero ajusta: reemplazan a los de la solicitud', async () => {
    await confirmQrRequest(REQ_ID, { items: [{ productId: P2, quantity: 3 }] }, waiter);
    const { items } = repo.confirmQrRequestWithRound.mock.calls[0][0];
    expect(items).toEqual([
      { productId: P2, productName: 'Pasta', unitPrice: 25000, quantity: 3, note: undefined },
    ]);
    expect(catalogClient.getProductsByIds).toHaveBeenCalledWith([P2]);
  });

  it('un producto agotado se omite y se informa; el resto pasa', async () => {
    repo.findQrRequestForResolution.mockResolvedValue(
      request({
        items: [
          { productId: P1, quantity: 1, note: null },
          { productId: P_OFF, quantity: 1, note: null },
        ],
      }),
    );
    catalogClient.getProductsByIds.mockResolvedValue(
      catalog([
        [P1, 'Pizza', 28000],
        [P_OFF, 'Tiramisu', 15000, false],
      ]),
    );
    const out = await confirmQrRequest(REQ_ID, undefined, waiter);
    expect(out.round.items).toHaveLength(1);
    expect(out.unavailable).toEqual([{ productId: P_OFF, name: 'Tiramisu' }]);
  });

  it('si no queda ningun producto disponible -> 409 NO_AVAILABLE_ITEMS y la solicitud sigue pendiente', async () => {
    catalogClient.getProductsByIds.mockResolvedValue([]);
    await expect(confirmQrRequest(REQ_ID, undefined, waiter)).rejects.toMatchObject({
      status: 409,
      code: 'NO_AVAILABLE_ITEMS',
    });
    expect(repo.confirmQrRequestWithRound).not.toHaveBeenCalled();
  });

  it('solicitud inexistente -> 404', async () => {
    repo.findQrRequestForResolution.mockResolvedValue(null);
    await expect(confirmQrRequest(REQ_ID, undefined, waiter)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('un mesero que no es el asignado -> 403; el ADMIN si puede', async () => {
    await expect(confirmQrRequest(REQ_ID, undefined, otherWaiter)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(repo.confirmQrRequestWithRound).not.toHaveBeenCalled();
    await expect(confirmQrRequest(REQ_ID, undefined, admin)).resolves.toHaveProperty('round');
    expect(repo.confirmQrRequestWithRound.mock.calls[0][0].resolvedBy).toBe(OTHER_ID);
  });

  it.each(['confirmada', 'rechazada'])(
    'una solicitud ya %s -> 409 INVALID_TRANSITION',
    async (status) => {
      repo.findQrRequestForResolution.mockResolvedValue(request({ status }));
      await expect(confirmQrRequest(REQ_ID, undefined, waiter)).rejects.toMatchObject({
        status: 409,
        code: 'INVALID_TRANSITION',
      });
      expect(repo.confirmQrRequestWithRound).not.toHaveBeenCalled();
    },
  );

  it.each(['EN_COBRO', 'CERRADA'])(
    'orden %s -> 409 INVALID_TRANSITION, sin consultar el catalogo',
    async (status) => {
      repo.findQrRequestForResolution.mockResolvedValue(
        request({ order: { ...request().order, status } }),
      );
      await expect(confirmQrRequest(REQ_ID, undefined, waiter)).rejects.toMatchObject({
        status: 409,
        code: 'INVALID_TRANSITION',
      });
      expect(catalogClient.getProductsByIds).not.toHaveBeenCalled();
    },
  );

  it('carrera: otro la resolvio entre la lectura y la escritura (null) -> 409 y no emite nada', async () => {
    repo.confirmQrRequestWithRound.mockResolvedValue(null);
    await expect(confirmQrRequest(REQ_ID, undefined, waiter)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
    });
    expect(events.emitRoundCreated).not.toHaveBeenCalled();
  });

  it('carrera: la orden paso a cobro durante la confirmacion -> 409 y no emite nada', async () => {
    repo.confirmQrRequestWithRound.mockResolvedValue('ORDER_NOT_OPEN');
    await expect(confirmQrRequest(REQ_ID, undefined, waiter)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
    });
    expect(events.emitRoundCreated).not.toHaveBeenCalled();
  });

  it('si falla el aviso en tiempo real la ronda ya guardada se responde igual', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    events.emitRoundCreated.mockImplementation(() => {
      throw new Error('Socket.io no inicializado');
    });
    await expect(confirmQrRequest(REQ_ID, undefined, waiter)).resolves.toHaveProperty('round');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('un error del catalogo se propaga (nada se guarda)', async () => {
    const boom = new Error('catalogo caido');
    catalogClient.getProductsByIds.mockRejectedValue(boom);
    await expect(confirmQrRequest(REQ_ID, undefined, waiter)).rejects.toBe(boom);
    expect(repo.confirmQrRequestWithRound).not.toHaveBeenCalled();
  });
});

describe('rejectQrRequest', () => {
  const rejected = (over = {}) => ({
    ...request(),
    status: 'rechazada',
    resolvedBy: WAITER_ID,
    resolvedAt: new Date('2026-11-08T10:06:00Z'),
    ...over,
  });

  beforeEach(() => {
    repo.markQrRequestRejected.mockResolvedValue(rejected());
  });

  it('marca rechazada con quien la resolvio y devuelve la QrRequest; no crea ronda ni avisa a cocina', async () => {
    const out = await rejectQrRequest(REQ_ID, waiter);
    expect(repo.markQrRequestRejected).toHaveBeenCalledWith({
      qrRequestId: REQ_ID,
      resolvedBy: WAITER_ID,
    });
    expect(out).toEqual({
      qrRequestId: REQ_ID,
      orderId: ORDER_ID,
      status: 'rechazada',
      createdAt: new Date('2026-11-08T10:00:00Z'),
      resolvedAt: new Date('2026-11-08T10:06:00Z'),
      resolvedBy: WAITER_ID,
      items: [
        { productId: P1, quantity: 2, note: 'sin sal' },
        { productId: P2, quantity: 1 },
      ],
    });
    expect(repo.confirmQrRequestWithRound).not.toHaveBeenCalled();
    expect(events.emitRoundCreated).not.toHaveBeenCalled();
  });

  it('se puede rechazar aunque la mesa este en cobro', async () => {
    repo.findQrRequestForResolution.mockResolvedValue(
      request({ order: { ...request().order, status: 'EN_COBRO' } }),
    );
    await expect(rejectQrRequest(REQ_ID, waiter)).resolves.toMatchObject({ status: 'rechazada' });
  });

  it('inexistente -> 404; de otro mesero -> 403; el ADMIN si puede', async () => {
    repo.findQrRequestForResolution.mockResolvedValueOnce(null);
    await expect(rejectQrRequest(REQ_ID, waiter)).rejects.toMatchObject({ status: 404 });
    await expect(rejectQrRequest(REQ_ID, otherWaiter)).rejects.toMatchObject({ status: 403 });
    expect(repo.markQrRequestRejected).not.toHaveBeenCalled();
    await expect(rejectQrRequest(REQ_ID, admin)).resolves.toMatchObject({ status: 'rechazada' });
  });

  it.each(['confirmada', 'rechazada'])('ya %s -> 409 INVALID_TRANSITION', async (status) => {
    repo.findQrRequestForResolution.mockResolvedValue(request({ status }));
    await expect(rejectQrRequest(REQ_ID, waiter)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
    });
    expect(repo.markQrRequestRejected).not.toHaveBeenCalled();
  });

  it('carrera: la escritura condicional no encontro pendiente (null) -> 409', async () => {
    repo.markQrRequestRejected.mockResolvedValue(null);
    await expect(rejectQrRequest(REQ_ID, waiter)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
    });
  });
});
