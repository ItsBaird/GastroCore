import { describe, expect, it } from 'vitest';
import {
  PAYMENT_METHODS,
  PRODUCTS,
  TABLE_NUMBERS,
  addDays,
  bogotaTime,
  buildHistoricalOrders,
  buildOpenScenarios,
  todayBogota,
  waiterId,
} from './data.js';
import { seedUuid } from './ids.js';

// 14-nov-2026, 3:00 p. m. en Colombia (20:00 UTC)
const NOW = new Date('2026-11-14T20:00:00Z');
const historical = buildHistoricalOrders({ now: NOW });
const open = buildOpenScenarios({ now: NOW });

// Replica de chk_items_lifecycle y chk_items_cancel de db/init/schema/orders.sql
function expectValidItem(item) {
  const { status } = item;
  const has = (field) => item[field] !== null && item[field] !== undefined;
  if (status === 'pendiente')
    expect([has('preparationStartedAt'), has('readyAt'), has('deliveredAt')]).toEqual([
      false,
      false,
      false,
    ]);
  if (status === 'en_preparacion')
    expect([has('preparationStartedAt'), has('readyAt'), has('deliveredAt')]).toEqual([
      true,
      false,
      false,
    ]);
  if (status === 'listo')
    expect([has('preparationStartedAt'), has('readyAt'), has('deliveredAt')]).toEqual([
      true,
      true,
      false,
    ]);
  if (status === 'entregado')
    expect([has('preparationStartedAt'), has('readyAt'), has('deliveredAt')]).toEqual([
      true,
      true,
      true,
    ]);
  if (status === 'cancelado') {
    expect(has('cancelledBy')).toBe(true);
  } else {
    expect([has('cancelledBy'), has('cancelledReason')]).toEqual([false, false]);
  }
  expect(item.quantity).toBeGreaterThan(0);
  expect(item.unitPriceSnapshot).toBeGreaterThanOrEqual(0);
  expect(item.note === null || item.note.length <= 255).toBe(true);
  expect(item.productNameSnapshot.length).toBeLessThanOrEqual(120);
}

describe('constantes compartidas con los otros seeds', () => {
  it('los meseros y productos usan los mismos ids que Auth y Catalog (seedUuid)', () => {
    expect(waiterId('mesero1')).toBe('fa6a2e90-5716-5f70-b2df-8a8ccc6529ec');
    expect(PRODUCTS.find((p) => p.slug === 'limonada-natural').productId).toBe(
      '010f9724-a9b3-5c3b-886d-22ba18ab2f33',
    );
    expect(PRODUCTS.find((p) => p.slug === 'pasta-carbonara').productId).toBe(
      'e62945fa-a44b-5fac-b010-08005ecc393b',
    );
  });

  it('hay metodos de pago de efectivo y electronicos, y uno inactivo', () => {
    expect(PAYMENT_METHODS.some((m) => m.isCash && m.isActive)).toBe(true);
    expect(PAYMENT_METHODS.some((m) => !m.isCash && m.isActive)).toBe(true);
    expect(PAYMENT_METHODS.some((m) => !m.isActive)).toBe(true);
    expect(new Set(PAYMENT_METHODS.map((m) => m.name)).size).toBe(PAYMENT_METHODS.length);
    for (const m of PAYMENT_METHODS) expect(m.name.length).toBeLessThanOrEqual(50);
  });

  it('el dia del restaurante es UTC-5', () => {
    expect(todayBogota(new Date('2026-11-15T01:00:00Z'))).toBe('2026-11-14');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('ordenes cerradas (historial)', () => {
  it('es determinista: repetirlo da exactamente lo mismo', () => {
    expect(buildHistoricalOrders({ now: NOW })).toEqual(
      buildHistoricalOrders({ now: new Date(NOW) }),
    );
  });

  it('cubre los 7 dias anteriores y hoy, con 5 a 9 ordenes por dia (hoy, solo las ya cerradas)', () => {
    const byDay = new Map();
    for (const o of historical) byDay.set(o.date, (byDay.get(o.date) ?? 0) + 1);
    expect([...byDay.keys()]).toEqual([
      '2026-11-07',
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
    ]);
    for (const [date, count] of byDay) {
      if (date !== '2026-11-14') {
        expect(count).toBeGreaterThanOrEqual(5);
        expect(count).toBeLessThanOrEqual(9);
      }
    }
  });

  it('nada cierra en el futuro: hoy solo entran las que cerraron al menos 5 minutos antes de ahora', () => {
    for (const o of historical)
      expect(o.closedAt.getTime()).toBeLessThanOrEqual(NOW.getTime() - 5 * 60 * 1000);
  });

  it('cada orden cierra DENTRO de su dia del restaurante (UTC-5)', () => {
    for (const o of historical) {
      const start = bogotaTime(o.date, '00:00');
      expect(o.closedAt >= start && o.closedAt < new Date(start.getTime() + 24 * 3600 * 1000)).toBe(
        true,
      );
    }
  });

  it('los tiempos son coherentes: apertura < rondas < items < cierre', () => {
    for (const o of historical) {
      expect(o.openedAt < o.closedAt).toBe(true);
      for (const round of o.rounds) {
        expect(round.createdAt > o.openedAt).toBe(true);
        for (const item of round.items) {
          expect(item.createdAt).toEqual(round.createdAt);
          if (item.deliveredAt) expect(item.deliveredAt <= o.closedAt).toBe(true);
        }
      }
    }
  });

  it('todas estan CERRADA, con el mesero que abrio la mesa y un mesero conocido', () => {
    const known = new Set(['mesero1', 'mesero2', 'mesero3'].map(waiterId));
    for (const o of historical) {
      expect(o.status).toBe('CERRADA');
      expect(o.openedBy).toBe(o.waiterId);
      expect(known.has(o.openedBy)).toBe(true);
      expect(TABLE_NUMBERS).toContain(o.tableNumber);
    }
  });

  it('el pago cuadra: subtotal = lineas no anuladas, total = subtotal - descuento (chk_payments_total_calc)', () => {
    for (const o of historical) {
      const lines = o.rounds.flatMap((r) => r.items).filter((i) => i.status !== 'cancelado');
      const subtotal = lines.reduce((s, i) => s + i.unitPriceSnapshot * i.quantity, 0);
      expect(o.payment.subtotal).toBe(subtotal);
      expect(o.payment.total).toBe(subtotal - o.payment.discountAmount);
      expect(o.payment.total).toBeGreaterThan(0);
    }
  });

  it('el descuento es coherente en la orden y en el pago (chk_orders_discount_trio, chk_payments_discount_by)', () => {
    const discounted = historical.filter((o) => o.discountAmount > 0);
    expect(discounted.length).toBeGreaterThan(0);
    for (const o of historical) {
      expect(o.payment.discountAmount).toBe(o.discountAmount);
      expect(o.payment.discountAppliedBy).toBe(o.discountAppliedBy);
      if (o.discountAmount > 0) {
        expect(o.discountAppliedBy).not.toBeNull();
        expect(o.discountAppliedAt).not.toBeNull();
      } else {
        expect([o.discountAppliedBy, o.discountAppliedAt]).toEqual([null, null]);
      }
    }
  });

  it('en efectivo se recibe >= total y el cambio es la diferencia; el resto no tiene ninguno de los dos', () => {
    const cashNames = new Set(PAYMENT_METHODS.filter((m) => m.isCash).map((m) => m.name));
    let cash = 0;
    for (const o of historical) {
      const p = o.payment;
      if (cashNames.has(p.methodName)) {
        cash += 1;
        expect(p.amountReceived).toBeGreaterThanOrEqual(p.total);
        expect(p.changeGiven).toBe(p.amountReceived - p.total);
      } else {
        expect([p.amountReceived, p.changeGiven]).toEqual([null, null]);
      }
    }
    expect(cash).toBeGreaterThan(0);
    expect(cash).toBeLessThan(historical.length);
  });

  it('solo usa metodos de pago activos, y hay mas de uno', () => {
    const active = new Set(PAYMENT_METHODS.filter((m) => m.isActive).map((m) => m.name));
    const used = new Set(historical.map((o) => o.payment.methodName));
    for (const name of used) expect(active.has(name)).toBe(true);
    expect(used.size).toBeGreaterThan(1);
  });

  it('cada item cumple las restricciones de la base y nunca vende un producto agotado', () => {
    const soldOut = new Set(PRODUCTS.filter((p) => !p.available).map((p) => p.productId));
    for (const o of historical) {
      for (const item of o.rounds.flatMap((r) => r.items)) {
        expectValidItem(item);
        if (item.status !== 'cancelado') expect(soldOut.has(item.productId)).toBe(false);
      }
    }
  });

  it('hay variedad de casos: rondas multiples y lineas anuladas', () => {
    expect(historical.some((o) => o.rounds.length === 2)).toBe(true);
    expect(
      historical.some((o) =>
        o.rounds.flatMap((r) => r.items).some((i) => i.status === 'cancelado'),
      ),
    ).toBe(true);
  });

  it('todos los ids son unicos (orden, rondas, items, pagos)', () => {
    const ids = historical.flatMap((o) => [
      o.orderId,
      o.payment.paymentId,
      ...o.rounds.flatMap((r) => [r.roundId, ...r.items.map((i) => i.itemId)]),
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('otro dia genera otras ordenes con otros ids, y un dia ya generado conserva los suyos', () => {
    const tomorrow = buildHistoricalOrders({ now: new Date(NOW.getTime() + 24 * 3600 * 1000) });
    const todayIdsBefore = historical.filter((o) => o.date === '2026-11-13').map((o) => o.orderId);
    const sameDayLater = tomorrow.filter((o) => o.date === '2026-11-13').map((o) => o.orderId);
    expect(sameDayLater).toEqual(todayIdsBefore);
    expect(tomorrow.some((o) => o.date === '2026-11-15')).toBe(true);
  });
});

describe('ordenes abiertas (cocina, cuenta, QR y llamados)', () => {
  it('es determinista', () => {
    expect(buildOpenScenarios({ now: NOW })).toEqual(buildOpenScenarios({ now: new Date(NOW) }));
  });

  it('a lo sumo una orden no cerrada por mesa (uix_orders_one_open_per_table)', () => {
    const tables = open.orders.map((o) => o.tableNumber);
    expect(new Set(tables).size).toBe(tables.length);
    for (const o of open.orders) expect(['ABIERTA', 'EN_COBRO']).toContain(o.status);
  });

  it('cubre todos los estados: cocina (pendiente, en preparacion, listo), entregado y una mesa en cobro', () => {
    const statuses = new Set(
      open.orders.flatMap((o) => o.rounds.flatMap((r) => r.items.map((i) => i.status))),
    );
    expect(statuses).toEqual(new Set(['pendiente', 'en_preparacion', 'listo', 'entregado']));
    expect(open.orders.some((o) => o.status === 'EN_COBRO')).toBe(true);
  });

  it('cada item cumple las restricciones y ningun tiempo esta en el futuro', () => {
    for (const o of open.orders) {
      expect(o.openedAt <= NOW).toBe(true);
      for (const round of o.rounds) {
        expect(round.createdAt <= NOW).toBe(true);
        expect(round.createdAt >= o.openedAt).toBe(true);
        for (const item of round.items) {
          expectValidItem(item);
          for (const t of [item.preparationStartedAt, item.readyAt, item.deliveredAt]) {
            if (t) expect(t <= NOW).toBe(true);
          }
        }
      }
    }
  });

  it('la solicitud QR es de una orden abierta, con cantidades validas y productos que crea el seed de Catalog', () => {
    const [request] = open.qrRequests;
    expect(open.orders.map((o) => o.orderId)).toContain(request.orderId);
    expect(request.createdAt <= NOW).toBe(true);
    for (const item of request.items) {
      expect(item.quantity).toBeGreaterThan(0);
      expect(PRODUCTS.some((p) => p.productId === item.productId && p.available)).toBe(true);
    }
  });

  it('un solo llamado pendiente por tipo y mesa (uix_service_calls_one_pending), sobre mesas existentes', () => {
    const keys = open.serviceCalls.map((c) => `${c.tableNumber}:${c.type}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const call of open.serviceCalls) {
      expect(TABLE_NUMBERS).toContain(call.tableNumber);
      expect(['call_waiter', 'request_bill']).toContain(call.type);
      expect(call.createdAt <= NOW).toBe(true);
    }
    // Una mesa libre llamando al mesero: no tiene orden abierta
    const freeCall = open.serviceCalls.find((c) => c.tableNumber === 7);
    expect(open.orders.some((o) => o.tableNumber === freeCall.tableNumber)).toBe(false);
  });

  it('no usa la mesa 1, que suele tener ya una orden creada a mano', () => {
    expect(open.orders.every((o) => o.tableNumber !== 1)).toBe(true);
    expect(open.serviceCalls.every((c) => c.tableNumber !== 1)).toBe(true);
  });

  it('sus ids no chocan con los del historial', () => {
    const ids = new Set(historical.map((o) => o.orderId));
    for (const o of open.orders) expect(ids.has(o.orderId)).toBe(false);
    expect(seedUuid('open-order:2')).toBe(open.orders[0].orderId);
  });
});
