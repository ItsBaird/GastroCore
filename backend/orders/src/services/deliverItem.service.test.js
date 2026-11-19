import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../repositories/item.repository.js', () => ({
  findItemWithOrder: vi.fn(),
  deliverReadyItem: vi.fn(),
}));
vi.mock('../realtime/events.js', () => ({ emitItemStatusChanged: vi.fn() }));

const repo = await import('../repositories/item.repository.js');
const events = await import('../realtime/events.js');
const { deliverItem } = await import('./deliverItem.service.js');

const ITEM_ID = 'item-1';
const WAITER = { userId: 'waiter-actual', role: 'WAITER' };
const OTHER_WAITER = { userId: 'otro-mesero', role: 'WAITER' };
const ADMIN = { userId: 'admin-1', role: 'ADMIN' };
const DELIVERED_AT = new Date('2026-11-07T18:30:00Z');

function makeItem(status, { orderStatus = 'ABIERTA', waiterId = 'waiter-actual' } = {}) {
  return {
    itemId: ITEM_ID,
    roundId: 'round-1',
    productId: 'prod-1',
    productNameSnapshot: 'Pizza',
    unitPriceSnapshot: 30000,
    quantity: 2,
    status,
    deliveredAt: status === 'entregado' ? DELIVERED_AT : null,
    round: {
      order: {
        orderId: 'order-1',
        status: orderStatus,
        waiterId,
        table: { tableNumber: 5 },
      },
    },
  };
}

beforeEach(() => vi.resetAllMocks());

describe('deliverItem', () => {
  it('listo -> entregado: devuelve el item con deliveredAt y precio del snapshot', async () => {
    repo.findItemWithOrder.mockResolvedValue(makeItem('listo'));
    repo.deliverReadyItem.mockResolvedValue(makeItem('entregado'));

    const result = await deliverItem(ITEM_ID, WAITER);

    expect(repo.deliverReadyItem).toHaveBeenCalledWith(ITEM_ID);
    expect(result).toMatchObject({
      itemId: ITEM_ID,
      status: 'entregado',
      deliveredAt: DELIVERED_AT,
      unitPrice: 30000,
      productName: 'Pizza',
    });
  });

  it('emite item:status_changed despues de escribir, al mesero actual', async () => {
    repo.findItemWithOrder.mockResolvedValue(makeItem('listo'));
    repo.deliverReadyItem.mockImplementation(async () => {
      expect(events.emitItemStatusChanged).not.toHaveBeenCalled();
      return makeItem('entregado');
    });

    await deliverItem(ITEM_ID, WAITER);

    expect(events.emitItemStatusChanged).toHaveBeenCalledOnce();
    expect(events.emitItemStatusChanged).toHaveBeenCalledWith({
      item: expect.objectContaining({ itemId: ITEM_ID, status: 'entregado' }),
      orderId: 'order-1',
      tableNumber: 5,
      waiterId: 'waiter-actual',
    });
  });

  it('tras una reasignacion el evento va al mesero nuevo, que es quien puede entregar', async () => {
    const reassigned = { orderStatus: 'ABIERTA', waiterId: 'mesero-nuevo' };
    repo.findItemWithOrder.mockResolvedValue(makeItem('listo', reassigned));
    repo.deliverReadyItem.mockResolvedValue(makeItem('entregado', reassigned));

    await expect(deliverItem(ITEM_ID, WAITER)).rejects.toMatchObject({ status: 403 });
    await deliverItem(ITEM_ID, { userId: 'mesero-nuevo', role: 'WAITER' });

    expect(events.emitItemStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({ waiterId: 'mesero-nuevo' }),
    );
  });

  it('el ADMIN entrega items de cualquier mesa', async () => {
    repo.findItemWithOrder.mockResolvedValue(makeItem('listo'));
    repo.deliverReadyItem.mockResolvedValue(makeItem('entregado'));

    await expect(deliverItem(ITEM_ID, ADMIN)).resolves.toMatchObject({ status: 'entregado' });
  });

  it('con la orden EN_COBRO se puede entregar (decision de la PARADA 0)', async () => {
    repo.findItemWithOrder.mockResolvedValue(makeItem('listo', { orderStatus: 'EN_COBRO' }));
    repo.deliverReadyItem.mockResolvedValue(makeItem('entregado', { orderStatus: 'EN_COBRO' }));

    await expect(deliverItem(ITEM_ID, WAITER)).resolves.toMatchObject({ status: 'entregado' });
  });

  it('otro mesero recibe 403 sin revelar el estado ni escribir', async () => {
    repo.findItemWithOrder.mockResolvedValue(makeItem('pendiente'));

    await expect(deliverItem(ITEM_ID, OTHER_WAITER)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(repo.deliverReadyItem).not.toHaveBeenCalled();
  });

  it('item inexistente responde 404', async () => {
    repo.findItemWithOrder.mockResolvedValue(null);

    await expect(deliverItem(ITEM_ID, WAITER)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it.each(['pendiente', 'en_preparacion', 'entregado', 'cancelado'])(
    'desde %s responde 409 INVALID_TRANSITION y no escribe',
    async (status) => {
      repo.findItemWithOrder.mockResolvedValue(makeItem(status));

      await expect(deliverItem(ITEM_ID, WAITER)).rejects.toMatchObject({
        status: 409,
        code: 'INVALID_TRANSITION',
        details: { from: status, to: 'entregado' },
      });
      expect(repo.deliverReadyItem).not.toHaveBeenCalled();
      expect(events.emitItemStatusChanged).not.toHaveBeenCalled();
    },
  );

  it('orden CERRADA responde 409 aunque el item siga listo', async () => {
    repo.findItemWithOrder.mockResolvedValue(makeItem('listo', { orderStatus: 'CERRADA' }));

    await expect(deliverItem(ITEM_ID, WAITER)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
    });
    expect(repo.deliverReadyItem).not.toHaveBeenCalled();
  });

  it('carrera: el ADMIN lo anulo entre la lectura y la escritura -> 409 con el estado real', async () => {
    repo.findItemWithOrder
      .mockResolvedValueOnce(makeItem('listo'))
      .mockResolvedValueOnce(makeItem('cancelado'));
    repo.deliverReadyItem.mockResolvedValue(null);

    await expect(deliverItem(ITEM_ID, WAITER)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
      details: { from: 'cancelado' },
    });
    expect(events.emitItemStatusChanged).not.toHaveBeenCalled();
  });

  it('carrera: otro dispositivo ya lo entrego -> 409, sin segundo evento', async () => {
    repo.findItemWithOrder
      .mockResolvedValueOnce(makeItem('listo'))
      .mockResolvedValueOnce(makeItem('entregado'));
    repo.deliverReadyItem.mockResolvedValue(null);

    await expect(deliverItem(ITEM_ID, WAITER)).rejects.toMatchObject({
      details: { from: 'entregado' },
    });
    expect(events.emitItemStatusChanged).not.toHaveBeenCalled();
  });
});
