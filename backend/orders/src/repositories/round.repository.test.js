// Alta de rondas reutilizable: dentro o fuera de una transaccion, ligada o no a una solicitud QR, y con el
// candado de la orden ABIERTA tomado antes de crear (sin carrera con solicitar el cobro o pagar).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tx = {
  order: { updateMany: vi.fn() },
  round: { create: vi.fn() },
};
const prisma = { round: { create: vi.fn() }, $transaction: vi.fn((fn) => fn(tx)) };
vi.mock('../config/prisma.js', () => ({ prisma }));

const { createRoundInOpenOrder, createRoundWithItems, lockOpenOrder } =
  await import('./round.repository.js');

const ITEMS = [
  { productId: 'p1', productName: 'Pizza', unitPrice: 28000, quantity: 2, note: 'sin sal' },
  { productId: 'p2', productName: 'Gaseosa', unitPrice: 5000, quantity: 1, note: undefined },
];
const ROUND = { orderId: 'o1', source: 'WAITER', createdBy: 'w1', items: ITEMS };

beforeEach(() => {
  vi.resetAllMocks();
  prisma.$transaction.mockImplementation((fn) => fn(tx));
  tx.round.create.mockResolvedValue({ roundId: 'r1' });
  prisma.round.create.mockResolvedValue({ roundId: 'r1' });
});

describe('createRoundWithItems', () => {
  it('sin tx usa prisma y sin solicitud deja qrRequestId en null (igual que antes)', async () => {
    await createRoundWithItems(ROUND);

    expect(prisma.round.create).toHaveBeenCalledWith({
      data: {
        orderId: 'o1',
        source: 'WAITER',
        createdBy: 'w1',
        qrRequestId: null,
        items: {
          create: [
            {
              productId: 'p1',
              productNameSnapshot: 'Pizza',
              unitPriceSnapshot: 28000,
              quantity: 2,
              note: 'sin sal',
            },
            {
              productId: 'p2',
              productNameSnapshot: 'Gaseosa',
              unitPriceSnapshot: 5000,
              quantity: 1,
              note: null,
            },
          ],
        },
      },
      include: { items: true },
    });
  });

  it('con tx y una solicitud QR crea dentro de la transaccion del llamador', async () => {
    await createRoundWithItems({ ...ROUND, source: 'QR', qrRequestId: 'q1' }, tx);

    expect(prisma.round.create).not.toHaveBeenCalled();
    expect(tx.round.create.mock.calls[0][0].data).toMatchObject({
      source: 'QR',
      qrRequestId: 'q1',
    });
  });
});

describe('lockOpenOrder', () => {
  it('UPDATE sin cambios condicionado a ABIERTA (toma el candado de fila)', async () => {
    tx.order.updateMany.mockResolvedValue({ count: 1 });

    await expect(lockOpenOrder(tx, 'o1')).resolves.toBe(true);
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { orderId: 'o1', status: 'ABIERTA' },
      data: { status: 'ABIERTA' },
    });
  });

  it('0 filas: la orden ya no esta ABIERTA', async () => {
    tx.order.updateMany.mockResolvedValue({ count: 0 });
    await expect(lockOpenOrder(tx, 'o1')).resolves.toBe(false);
  });
});

describe('createRoundInOpenOrder', () => {
  it('bloquea la orden y crea la ronda en la misma transaccion', async () => {
    tx.order.updateMany.mockResolvedValue({ count: 1 });

    await expect(createRoundInOpenOrder(ROUND)).resolves.toEqual({ roundId: 'r1' });
    expect(tx.order.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.round.create.mock.invocationCallOrder[0],
    );
  });

  it('si la orden dejo de estar ABIERTA devuelve null y no crea nada', async () => {
    tx.order.updateMany.mockResolvedValue({ count: 0 });

    await expect(createRoundInOpenOrder(ROUND)).resolves.toBeNull();
    expect(tx.round.create).not.toHaveBeenCalled();
  });
});
