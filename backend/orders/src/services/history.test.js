import { describe, expect, it } from 'vitest';
import {
  buildHistorySummary,
  referenceOf,
  toHistoryOrder,
  toHistoryOrderDetail,
} from './history.js';

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

describe('toHistoryOrderDetail (GC-189)', () => {
  const line = (productId, name, price, quantity) => ({
    productId,
    productNameSnapshot: name,
    unitPriceSnapshot: price,
    quantity,
  });
  const detail = (paymentOverrides = {}) =>
    toHistoryOrderDetail(
      order({
        payment: {
          subtotal: 101000,
          discountAmount: 11000,
          total: 90000,
          paymentMethodId: 'm-cash',
          amountReceived: 100000,
          changeGiven: 10000,
          ...paymentOverrides,
        },
        rounds: [
          { items: [line('p1', 'Pizza Margarita', 28000, 2), line('p2', 'Limonada', 8000, 1)] },
          { items: [line('p3', 'Tiramisú', 37000, 1)] },
        ],
      }),
    );

  it('trae la fila del historial mas las lineas con el snapshot R3 (nombre y precio al pedir)', () => {
    const out = detail();
    expect(out).toMatchObject({
      orderId: ORDER_ID,
      reference: '3F9A1C',
      tableNumber: 7,
      itemsCount: 4,
    });
    expect(out.lines).toEqual([
      {
        productId: 'p1',
        productName: 'Pizza Margarita',
        quantity: 2,
        unitPrice: 28000,
        lineTotal: 56000,
      },
      { productId: 'p2', productName: 'Limonada', quantity: 1, unitPrice: 8000, lineTotal: 8000 },
      { productId: 'p3', productName: 'Tiramisú', quantity: 1, unitPrice: 37000, lineTotal: 37000 },
    ]);
  });

  it('hecho cuando: las lineas suman el subtotal y total = subtotal - descuento', () => {
    const out = detail();
    expect(out.lines.reduce((s, l) => s + l.lineTotal, 0)).toBe(out.subtotal);
    expect(out.total).toBe(out.subtotal - out.discountAmount);
  });

  it('en efectivo trae lo recibido y el cambio', () => {
    expect(detail()).toMatchObject({ cashReceived: 100000, changeGiven: 10000 });
  });

  it('con otro metodo, recibido y cambio van en null', () => {
    const out = detail({ paymentMethodId: 'm-card', amountReceived: null, changeGiven: null });
    expect(out.cashReceived).toBeNull();
    expect(out.changeGiven).toBeNull();
  });

  it('respeta el orden de las rondas y de los items dentro de cada ronda', () => {
    expect(detail().lines.map((l) => l.productId)).toEqual(['p1', 'p2', 'p3']);
  });
});
