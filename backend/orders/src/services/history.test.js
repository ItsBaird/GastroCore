import { describe, expect, it } from 'vitest';
import { buildHistorySummary, referenceOf, toHistoryOrder } from './history.js';

const ORDER_ID = '3f9a1c7e-0b2d-4e5f-8a9b-1c2d3e4f5a6b';

const order = (overrides = {}) => ({
  orderId: ORDER_ID,
  tableId: 't-1',
  openedBy: 'w-1',
  openedAt: new Date('2026-11-14T17:00:00Z'),
  closedAt: new Date('2026-11-14T19:00:00Z'),
  table: { tableNumber: 7 },
  payment: { subtotal: 100000, discountAmount: 10000, total: 90000, paymentMethodId: 'm-1' },
  rounds: [{ items: [{ quantity: 2 }, { quantity: 1 }] }, { items: [{ quantity: 3 }] }],
  ...overrides,
});

describe('referenceOf', () => {
  it('son los 6 primeros caracteres del UUID en mayusculas', () => {
    expect(referenceOf(ORDER_ID)).toBe('3F9A1C');
    expect(referenceOf('abcdef00-0000-4000-8000-000000000000')).toBe('ABCDEF');
  });
});

describe('toHistoryOrder', () => {
  it('arma la fila del contrato (HistoryOrder) con la referencia, la mesa y el mesero que abrio', () => {
    expect(toHistoryOrder(order())).toEqual({
      orderId: ORDER_ID,
      reference: '3F9A1C',
      tableId: 't-1',
      tableNumber: 7,
      waiterId: 'w-1',
      openedAt: new Date('2026-11-14T17:00:00Z'),
      closedAt: new Date('2026-11-14T19:00:00Z'),
      itemsCount: 6,
      subtotal: 100000,
      discountAmount: 10000,
      total: 90000,
      paymentMethodId: 'm-1',
    });
  });

  it('itemsCount suma UNIDADES de todas las rondas, no lineas', () => {
    expect(toHistoryOrder(order({ rounds: [{ items: [{ quantity: 4 }] }] })).itemsCount).toBe(4);
  });

  it('una ronda sin items vendidos (todo cancelado) aporta 0', () => {
    expect(
      toHistoryOrder(order({ rounds: [{ items: [] }, { items: [{ quantity: 1 }] }] })).itemsCount,
    ).toBe(1);
  });

  it('los montos son los del PAGO (snapshot R3): no se recalculan con los items', () => {
    const row = toHistoryOrder(order({ rounds: [{ items: [{ quantity: 99 }] }] }));
    expect(row).toMatchObject({ subtotal: 100000, discountAmount: 10000, total: 90000 });
  });
});

describe('buildHistorySummary', () => {
  it('ticket promedio = ventas / cuentas, redondeado al entero mas cercano', () => {
    expect(buildHistorySummary({ totalSales: 100000, ordersCount: 3 })).toEqual({
      totalSales: 100000,
      ordersCount: 3,
      averageTicket: 33333,
    });
    expect(buildHistorySummary({ totalSales: 100001, ordersCount: 2 }).averageTicket).toBe(50001);
  });

  it('sin cuentas: todo en 0 (no divide por cero)', () => {
    expect(buildHistorySummary({ totalSales: 0, ordersCount: 0 })).toEqual({
      totalSales: 0,
      ordersCount: 0,
      averageTicket: 0,
    });
  });
});
