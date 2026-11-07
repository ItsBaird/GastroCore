import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../repositories/item.repository.js', () => ({
  findItemWithOrder: vi.fn(),
  advanceItemStatus: vi.fn(),
}));
vi.mock('../realtime/events.js', () => ({ emitItemStatusChanged: vi.fn() }));

const repo = await import('../repositories/item.repository.js');
const events = await import('../realtime/events.js');
const { updateItemStatus } = await import('./itemStatus.service.js');

const ITEM_ID = 'item-1';

function makeItem(status, orderStatus = 'ABIERTA') {
  return {
    itemId: ITEM_ID,
    status,
    productNameSnapshot: 'Pizza',
    unitPriceSnapshot: 30000,
    round: {
      order: {
        orderId: 'order-1',
        status: orderStatus,
        waiterId: 'waiter-actual',
        table: { tableNumber: 5 },
      },
    },
  };
}

beforeEach(() => vi.resetAllMocks());

describe('updateItemStatus', () => {
  it.each([
    ['pendiente', 'en_preparacion', 'preparationStartedAt'],
    ['en_preparacion', 'listo', 'readyAt'],
  ])('avanza de %s a %s y registra %s', async (from, to, timestampField) => {
    repo.findItemWithOrder.mockResolvedValue(makeItem(from));
    repo.advanceItemStatus.mockResolvedValue(makeItem(to));

    const result = await updateItemStatus(ITEM_ID, to);

    expect(repo.advanceItemStatus).toHaveBeenCalledWith({
      itemId: ITEM_ID,
      from,
      to,
      timestampField,
    });
    expect(result.status).toBe(to);
  });

  it('avanza un item de una orden EN_COBRO: la cocina termina lo que tiene', async () => {
    repo.findItemWithOrder.mockResolvedValue(makeItem('pendiente', 'EN_COBRO'));
    repo.advanceItemStatus.mockResolvedValue(makeItem('en_preparacion', 'EN_COBRO'));

    await expect(updateItemStatus(ITEM_ID, 'en_preparacion')).resolves.toBeTruthy();
  });

  it('emite al mesero actual de la orden, con mesa y orden', async () => {
    repo.findItemWithOrder.mockResolvedValue(makeItem('pendiente'));
    repo.advanceItemStatus.mockResolvedValue(makeItem('en_preparacion'));

    await updateItemStatus(ITEM_ID, 'en_preparacion');

    expect(events.emitItemStatusChanged).toHaveBeenCalledOnce();
    expect(events.emitItemStatusChanged).toHaveBeenCalledWith({
      item: expect.objectContaining({ itemId: ITEM_ID, status: 'en_preparacion' }),
      orderId: 'order-1',
      tableNumber: 5,
      waiterId: 'waiter-actual',
    });
  });

  it('item inexistente responde 404', async () => {
    repo.findItemWithOrder.mockResolvedValue(null);

    await expect(updateItemStatus(ITEM_ID, 'listo')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it.each([
    ['pendiente', 'listo'],
    ['pendiente', 'pendiente'],
    ['en_preparacion', 'en_preparacion'],
    ['en_preparacion', 'pendiente'],
    ['listo', 'en_preparacion'],
    ['listo', 'entregado'],
    ['pendiente', 'cancelado'],
    ['entregado', 'listo'],
    ['cancelado', 'en_preparacion'],
  ])('de %s a %s responde 409 sin escribir ni emitir', async (from, to) => {
    repo.findItemWithOrder.mockResolvedValue(makeItem(from));

    await expect(updateItemStatus(ITEM_ID, to)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
    });
    expect(repo.advanceItemStatus).not.toHaveBeenCalled();
    expect(events.emitItemStatusChanged).not.toHaveBeenCalled();
  });

  it('orden cerrada responde 409 sin escribir', async () => {
    repo.findItemWithOrder.mockResolvedValue(makeItem('pendiente', 'CERRADA'));

    await expect(updateItemStatus(ITEM_ID, 'en_preparacion')).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
    });
    expect(repo.advanceItemStatus).not.toHaveBeenCalled();
  });

  it('si otro cocinero gano la carrera responde 409 con el estado real y no emite', async () => {
    repo.findItemWithOrder
      .mockResolvedValueOnce(makeItem('pendiente'))
      .mockResolvedValueOnce(makeItem('en_preparacion'));
    repo.advanceItemStatus.mockResolvedValue(null);

    await expect(updateItemStatus(ITEM_ID, 'en_preparacion')).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_TRANSITION',
      details: { from: 'en_preparacion', to: 'en_preparacion' },
    });
    expect(events.emitItemStatusChanged).not.toHaveBeenCalled();
  });
});
