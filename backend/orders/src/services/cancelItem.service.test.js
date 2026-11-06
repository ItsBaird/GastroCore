import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../repositories/item.repository.js');
vi.mock('../realtime/events.js');
vi.mock('./tableStatus.service.js');

const repo = await import('../repositories/item.repository.js');
const events = await import('../realtime/events.js');
const tableStatus = await import('./tableStatus.service.js');
const { cancelItem } = await import('./cancelItem.service.js');
const { cancelItemBodySchema, itemIdParamsSchema } = await import('../schemas/item.schema.js');

const ITEM_ID = '00000000-0000-4000-a000-000000000011';
const ORDER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const TABLE_ID = 'cccccccc-dddd-4000-a000-000000000003';
const WAITER_ID = '11111111-2222-3333-4444-555555555555';
const OTHER_ID = '22222222-3333-4444-5555-666666666666';
const PRODUCT_ID = '00000000-0000-4000-a000-000000000001';

const waiterUser = { userId: WAITER_ID, role: 'WAITER' };
const otherWaiter = { userId: OTHER_ID, role: 'WAITER' };
const adminUser = { userId: OTHER_ID, role: 'ADMIN' };

const REASON = 'El cliente cambió de opinión';

function makeItem({ status = 'pendiente', orderStatus = 'ABIERTA', waiterId = WAITER_ID } = {}) {
  return {
    itemId: ITEM_ID,
    roundId: 'round-1',
    productId: PRODUCT_ID,
    productNameSnapshot: 'Pizza Margarita',
    unitPriceSnapshot: 28000,
    quantity: 2,
    note: null,
    status,
    preparationStartedAt: null,
    readyAt: null,
    deliveredAt: null,
    cancelledReason: null,
    cancelledBy: null,
    createdAt: new Date('2026-11-06T12:00:00Z'),
    updatedAt: new Date('2026-11-06T12:00:00Z'),
    round: {
      order: {
        orderId: ORDER_ID,
        tableId: TABLE_ID,
        waiterId,
        status: orderStatus,
        table: { tableId: TABLE_ID, tableNumber: 7 },
      },
    },
  };
}

function cancelledRow(previousStatus = 'pendiente') {
  const base = makeItem({ status: previousStatus });
  delete base.round;
  return {
    ...base,
    status: 'cancelado',
    cancelledBy: WAITER_ID,
    cancelledReason: REASON,
    updatedAt: new Date('2026-11-06T12:05:00Z'),
  };
}

async function expectRejection(promise, { status, code }) {
  await expect(promise).rejects.toMatchObject({ status, code });
}

beforeEach(() => {
  vi.resetAllMocks();
  tableStatus.getTableStatus.mockResolvedValue({
    tableId: TABLE_ID,
    tableNumber: 7,
    status: 'ocupada',
    orderId: ORDER_ID,
    waiterId: WAITER_ID,
    itemsCount: 0,
    pendingCalls: [],
  });
});

describe('cancelItem', () => {
  describe('escenario 1: el mesero asignado anula un ítem pendiente', () => {
    beforeEach(() => {
      repo.findItemWithOrder.mockResolvedValue(makeItem({ status: 'pendiente' }));
      repo.cancelItemIfStatusIn.mockResolvedValue({ applied: true, item: cancelledRow() });
    });

    it('lo deja en cancelado con el motivo y quién lo anuló', async () => {
      const result = await cancelItem(ITEM_ID, REASON, waiterUser);

      expect(result.status).toBe('cancelado');
      expect(result.cancelledBy).toBe(WAITER_ID);
      expect(result.cancelledReason).toBe(REASON);
      expect(result.productName).toBe('Pizza Margarita');
      expect(result.unitPrice).toBe(28000);
    });

    it('no expone un cancelledAt que no existe en el esquema', async () => {
      const result = await cancelItem(ITEM_ID, REASON, waiterUser);

      expect(result).not.toHaveProperty('cancelledAt');
    });

    it('solo permite anular desde pendiente', async () => {
      await cancelItem(ITEM_ID, REASON, waiterUser);

      expect(repo.cancelItemIfStatusIn).toHaveBeenCalledWith(
        expect.objectContaining({
          itemId: ITEM_ID,
          allowedStatuses: ['pendiente'],
          userId: WAITER_ID,
          reason: REASON,
        }),
      );
    });

    it('registra en auditoría el estado anterior real y el monto anulado', async () => {
      await cancelItem(ITEM_ID, REASON, waiterUser);

      const { buildAuditDetails } = repo.cancelItemIfStatusIn.mock.calls[0][0];

      expect(buildAuditDetails('pendiente')).toEqual({
        previousStatus: 'pendiente',
        reason: REASON,
        orderId: ORDER_ID,
        tableNumber: 7,
        productId: PRODUCT_ID,
        productName: 'Pizza Margarita',
        quantity: 2,
        unitPrice: 28000,
        cancelledAmount: 56000,
      });
    });

    it('emite item:status_changed a cocina y al mesero asignado', async () => {
      await cancelItem(ITEM_ID, REASON, waiterUser);

      expect(events.emitItemStatusChanged).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: ORDER_ID,
          tableNumber: 7,
          waiterId: WAITER_ID,
          item: expect.objectContaining({ itemId: ITEM_ID, status: 'cancelado' }),
        }),
      );
    });

    it('reenvía al panel el estado de la mesa recalculado', async () => {
      await cancelItem(ITEM_ID, REASON, waiterUser);

      expect(tableStatus.getTableStatus).toHaveBeenCalledWith(TABLE_ID);
      expect(events.emitTableStatusChanged).toHaveBeenCalledWith(
        expect.objectContaining({ tableId: TABLE_ID, itemsCount: 0 }),
      );
    });
  });

  describe('escenario 2: el ADMIN anula ítems avanzados', () => {
    it.each(['pendiente', 'en_preparacion', 'listo'])('anula un ítem %s', async (status) => {
      repo.findItemWithOrder.mockResolvedValue(makeItem({ status }));
      repo.cancelItemIfStatusIn.mockResolvedValue({
        applied: true,
        item: cancelledRow(status),
      });

      const result = await cancelItem(ITEM_ID, REASON, adminUser);

      expect(result.status).toBe('cancelado');
      expect(repo.cancelItemIfStatusIn).toHaveBeenCalledWith(
        expect.objectContaining({
          allowedStatuses: ['pendiente', 'en_preparacion', 'listo'],
          userId: OTHER_ID,
        }),
      );
    });

    it('audita el estado anterior en_preparacion con su monto', async () => {
      repo.findItemWithOrder.mockResolvedValue(makeItem({ status: 'en_preparacion' }));
      repo.cancelItemIfStatusIn.mockResolvedValue({
        applied: true,
        item: cancelledRow('en_preparacion'),
      });

      await cancelItem(ITEM_ID, REASON, adminUser);
      const { buildAuditDetails } = repo.cancelItemIfStatusIn.mock.calls[0][0];

      expect(buildAuditDetails('en_preparacion')).toMatchObject({
        previousStatus: 'en_preparacion',
        cancelledAmount: 56000,
      });
    });

    it('el ADMIN no necesita tener la mesa asignada', async () => {
      repo.findItemWithOrder.mockResolvedValue(makeItem({ status: 'listo', waiterId: WAITER_ID }));
      repo.cancelItemIfStatusIn.mockResolvedValue({
        applied: true,
        item: cancelledRow('listo'),
      });

      await expect(cancelItem(ITEM_ID, REASON, adminUser)).resolves.toMatchObject({
        status: 'cancelado',
      });
    });
  });

  describe('escenario 3: el mesero no puede anular fuera de pendiente', () => {
    it.each(['en_preparacion', 'listo'])('responde 403 con un ítem %s', async (status) => {
      repo.findItemWithOrder.mockResolvedValue(makeItem({ status }));

      await expectRejection(cancelItem(ITEM_ID, REASON, waiterUser), {
        status: 403,
        code: 'FORBIDDEN',
      });

      expect(repo.cancelItemIfStatusIn).not.toHaveBeenCalled();
      expect(events.emitItemStatusChanged).not.toHaveBeenCalled();
    });

    it('el mensaje dice que solo el ADMIN puede', async () => {
      repo.findItemWithOrder.mockResolvedValue(makeItem({ status: 'listo' }));

      await expect(cancelItem(ITEM_ID, REASON, waiterUser)).rejects.toThrow(
        /Solo el ADMIN puede anular ítems fuera del estado pendiente/,
      );
    });
  });

  describe('transiciones terminales', () => {
    it.each(['entregado', 'cancelado'])('un ítem %s responde 409 al ADMIN', async (status) => {
      repo.findItemWithOrder.mockResolvedValue(makeItem({ status }));

      await expectRejection(cancelItem(ITEM_ID, REASON, adminUser), {
        status: 409,
        code: 'INVALID_TRANSITION',
      });

      expect(repo.cancelItemIfStatusIn).not.toHaveBeenCalled();
    });
  });

  describe('pertenencia y existencia', () => {
    it('otro mesero recibe 403 aunque el ítem esté pendiente', async () => {
      repo.findItemWithOrder.mockResolvedValue(makeItem({ status: 'pendiente' }));

      await expectRejection(cancelItem(ITEM_ID, REASON, otherWaiter), {
        status: 403,
        code: 'FORBIDDEN',
      });

      expect(repo.cancelItemIfStatusIn).not.toHaveBeenCalled();
    });

    it('un ítem inexistente responde 404', async () => {
      repo.findItemWithOrder.mockResolvedValue(null);

      await expectRejection(cancelItem(ITEM_ID, REASON, adminUser), {
        status: 404,
        code: 'NOT_FOUND',
      });
    });
  });

  describe('estado de la orden', () => {
    it.each(['EN_COBRO', 'CERRADA'])('una orden %s responde 409', async (orderStatus) => {
      repo.findItemWithOrder.mockResolvedValue(makeItem({ orderStatus }));

      await expectRejection(cancelItem(ITEM_ID, REASON, adminUser), {
        status: 409,
        code: 'INVALID_TRANSITION',
      });

      expect(repo.cancelItemIfStatusIn).not.toHaveBeenCalled();
    });
  });

  describe('carrera con cocina', () => {
    it('si el ítem pasó a en_preparacion, el mesero recibe 403', async () => {
      repo.findItemWithOrder
        .mockResolvedValueOnce(makeItem({ status: 'pendiente' }))
        .mockResolvedValueOnce(makeItem({ status: 'en_preparacion' }));
      repo.cancelItemIfStatusIn.mockResolvedValue({ applied: false, status: 'en_preparacion' });

      await expectRejection(cancelItem(ITEM_ID, REASON, waiterUser), {
        status: 403,
        code: 'FORBIDDEN',
      });

      expect(events.emitItemStatusChanged).not.toHaveBeenCalled();
      expect(events.emitTableStatusChanged).not.toHaveBeenCalled();
    });

    it('si otro dispositivo ya lo canceló, responde 409', async () => {
      repo.findItemWithOrder
        .mockResolvedValueOnce(makeItem({ status: 'pendiente' }))
        .mockResolvedValueOnce(makeItem({ status: 'cancelado' }));
      repo.cancelItemIfStatusIn.mockResolvedValue({ applied: false, status: 'cancelado' });

      await expectRejection(cancelItem(ITEM_ID, REASON, waiterUser), {
        status: 409,
        code: 'INVALID_TRANSITION',
      });
    });

    it('si el estado sigue siendo anulable por el rol, pide reintentar con 409', async () => {
      repo.findItemWithOrder
        .mockResolvedValueOnce(makeItem({ status: 'pendiente' }))
        .mockResolvedValueOnce(makeItem({ status: 'listo' }));
      repo.cancelItemIfStatusIn.mockResolvedValue({ applied: false, status: 'listo' });

      await expect(cancelItem(ITEM_ID, REASON, adminUser)).rejects.toMatchObject({
        status: 409,
        code: 'INVALID_TRANSITION',
        message: expect.stringContaining('vuelve a intentarlo'),
      });
    });

    it('si el ítem desapareció, responde 404', async () => {
      repo.findItemWithOrder
        .mockResolvedValueOnce(makeItem({ status: 'pendiente' }))
        .mockResolvedValueOnce(null);
      repo.cancelItemIfStatusIn.mockResolvedValue({ applied: false, status: null });

      await expectRejection(cancelItem(ITEM_ID, REASON, waiterUser), {
        status: 404,
        code: 'NOT_FOUND',
      });
    });
  });

  describe('auditoría y atomicidad', () => {
    it('si la transacción falla no se emite ningún evento', async () => {
      repo.findItemWithOrder.mockResolvedValue(makeItem({ status: 'pendiente' }));
      repo.cancelItemIfStatusIn.mockRejectedValue(new Error('audit_log insert failed'));

      await expect(cancelItem(ITEM_ID, REASON, waiterUser)).rejects.toThrow(
        'audit_log insert failed',
      );

      expect(events.emitItemStatusChanged).not.toHaveBeenCalled();
      expect(events.emitTableStatusChanged).not.toHaveBeenCalled();
    });
  });
});

describe('esquemas de anulación', () => {
  it('acepta un motivo normal y lo recorta', () => {
    expect(cancelItemBodySchema.parse({ reason: `  ${REASON}  ` })).toEqual({ reason: REASON });
  });

  it.each([
    ['vacío', ''],
    ['solo espacios', '    '],
  ])('rechaza un motivo %s', (_label, reason) => {
    expect(cancelItemBodySchema.safeParse({ reason }).success).toBe(false);
  });

  it('rechaza un motivo de más de 255 caracteres', () => {
    expect(cancelItemBodySchema.safeParse({ reason: 'x'.repeat(256) }).success).toBe(false);
    expect(cancelItemBodySchema.safeParse({ reason: 'x'.repeat(255) }).success).toBe(true);
  });

  it('rechaza el motivo ausente', () => {
    expect(cancelItemBodySchema.safeParse({}).success).toBe(false);
  });

  it('rechaza campos extra como status o cancelledBy (R4)', () => {
    expect(cancelItemBodySchema.safeParse({ reason: REASON, status: 'cancelado' }).success).toBe(
      false,
    );
    expect(cancelItemBodySchema.safeParse({ reason: REASON, cancelledBy: WAITER_ID }).success).toBe(
      false,
    );
  });

  it('exige que el id del ítem sea un uuid', () => {
    expect(itemIdParamsSchema.safeParse({ id: ITEM_ID }).success).toBe(true);
    expect(itemIdParamsSchema.safeParse({ id: 'items' }).success).toBe(false);
  });
});
