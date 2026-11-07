// GC-ORD-0005 subtarea 2: la entrega reutiliza la sala waiter:{userId} y item:status_changed de
// GC-ORD-0004. Aqui corren juntos el servicio real y el emisor real; solo se simulan el repositorio e io.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../repositories/item.repository.js', () => ({
  findItemWithOrder: vi.fn(),
  deliverReadyItem: vi.fn(),
}));

const repo = await import('../repositories/item.repository.js');
const { setIo } = await import('./events.js');
const { deliverItem } = await import('../services/deliverItem.service.js');

// Campos requeridos por el contrato: Item + orderId y tableNumber (ItemStatusChangedEvent)
const REQUIRED = [
  'itemId',
  'roundId',
  'productId',
  'productName',
  'unitPrice',
  'quantity',
  'status',
  'orderId',
  'tableNumber',
];

function row(status, waiterId) {
  return {
    itemId: 'item-1',
    roundId: 'round-1',
    productId: 'prod-1',
    productNameSnapshot: 'Pizzeta Pepperoni',
    unitPriceSnapshot: 35000,
    quantity: 2,
    note: null,
    status,
    preparationStartedAt: new Date('2026-11-07T18:00:00Z'),
    readyAt: new Date('2026-11-07T18:10:00Z'),
    deliveredAt: status === 'entregado' ? new Date('2026-11-07T18:12:00Z') : null,
    cancelledReason: null,
    cancelledBy: null,
    createdAt: new Date('2026-11-07T17:55:00Z'),
    updatedAt: new Date('2026-11-07T18:12:00Z'),
    round: { order: { orderId: 'order-1', status: 'ABIERTA', waiterId, table: { tableNumber: 9 } } },
  };
}

let to;
let emit;

beforeEach(() => {
  vi.resetAllMocks();
  emit = vi.fn();
  to = vi.fn(() => ({ emit }));
  setIo({ to });
});

describe('entregar emite item:status_changed', () => {
  it('una sola emision a kitchen y al mesero actual con el payload del contrato', async () => {
    repo.findItemWithOrder.mockResolvedValue(row('listo', 'mesero-b'));
    repo.deliverReadyItem.mockResolvedValue(row('entregado', 'mesero-b'));

    await deliverItem('item-1', { userId: 'mesero-b', role: 'WAITER' });

    expect(to).toHaveBeenCalledOnce();
    expect(to).toHaveBeenCalledWith(['kitchen', 'waiter:mesero-b']);
    expect(emit).toHaveBeenCalledOnce();
    const [event, payload] = emit.mock.calls[0];
    expect(event).toBe('item:status_changed');
    for (const key of REQUIRED) expect(payload).toHaveProperty(key);
    expect(payload).toMatchObject({
      status: 'entregado',
      orderId: 'order-1',
      tableNumber: 9,
      unitPrice: 35000,
    });
    expect(payload.deliveredAt).toEqual(new Date('2026-11-07T18:12:00Z'));
  });

  it('el ADMIN que entrega en una mesa ajena no cambia el destinatario: va al mesero asignado', async () => {
    repo.findItemWithOrder.mockResolvedValue(row('listo', 'mesero-b'));
    repo.deliverReadyItem.mockResolvedValue(row('entregado', 'mesero-b'));

    await deliverItem('item-1', { userId: 'admin-1', role: 'ADMIN' });

    expect(to).toHaveBeenCalledWith(['kitchen', 'waiter:mesero-b']);
  });

  it('si la entrega falla no se emite nada', async () => {
    repo.findItemWithOrder.mockResolvedValue(row('en_preparacion', 'mesero-b'));

    await expect(deliverItem('item-1', { userId: 'mesero-b', role: 'WAITER' })).rejects.toThrow();
    expect(to).not.toHaveBeenCalled();
  });
});
