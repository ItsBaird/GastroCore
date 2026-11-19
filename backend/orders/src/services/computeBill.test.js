import { describe, expect, it } from 'vitest';
import { assertBillPayable, computeBill } from './computeBill.js';

let seq = 0;
function item(status, unitPriceSnapshot, quantity, extra = {}) {
  seq += 1;
  return {
    itemId: `item-${seq}`,
    roundId: 'round',
    productId: `prod-${seq}`,
    productNameSnapshot: `Producto ${seq}`,
    unitPriceSnapshot,
    quantity,
    note: null,
    status,
    ...extra,
  };
}

function order(rounds, discountAmount = 0) {
  return { orderId: 'order-1', discountAmount, rounds: rounds.map((items) => ({ items })) };
}

describe('computeBill', () => {
  it('suma varias rondas y cantidades con el precio del snapshot', () => {
    const bill = computeBill(
      order([[item('entregado', 35000, 2), item('listo', 45000, 1)], [item('pendiente', 2000, 3)]]),
    );

    expect(bill.items.map((i) => i.lineTotal)).toEqual([70000, 45000, 6000]);
    expect(bill.subtotal).toBe(121000);
    expect(bill.discountAmount).toBe(0);
    expect(bill.total).toBe(121000);
  });

  it('excluye los items cancelados', () => {
    const bill = computeBill(
      order([[item('entregado', 10000, 1), item('cancelado', 99000, 5, { cancelledBy: 'u' })]]),
    );

    expect(bill.items).toHaveLength(1);
    expect(bill.subtotal).toBe(10000);
  });

  it('usa el snapshot aunque el producto haya cambiado de precio en Catalog (R3)', () => {
    // El item guarda 28000; si Catalog hoy dice 31000 da igual: computeBill no conoce Catalog
    const bill = computeBill(order([[item('entregado', 28000, 1)]]));

    expect(bill.items[0]).toMatchObject({ unitPrice: 28000, lineTotal: 28000 });
    expect(bill.total).toBe(28000);
  });

  it.each([
    ['nulo', null, 0, 50000],
    ['cero', 0, 0, 50000],
    ['positivo', 12000, 12000, 38000],
  ])('descuento %s', (_label, discount, expectedDiscount, expectedTotal) => {
    const bill = computeBill(order([[item('entregado', 25000, 2)]], discount));

    expect(bill.discountAmount).toBe(expectedDiscount);
    expect(bill.total).toBe(expectedTotal);
    expect(bill.total).toBe(bill.subtotal - bill.discountAmount);
  });

  it('todo es entero (R5)', () => {
    const bill = computeBill(order([[item('entregado', 3333, 3), item('listo', 1, 7)]], 1));

    for (const value of [
      bill.subtotal,
      bill.discountAmount,
      bill.total,
      ...bill.items.map((i) => i.lineTotal),
    ]) {
      expect(Number.isInteger(value)).toBe(true);
    }
    expect(bill.total).toBe(10005);
  });

  it('sin items no cancelados la cuenta queda en cero', () => {
    const bill = computeBill(order([[item('cancelado', 10000, 1, { cancelledBy: 'u' })], []]));

    expect(bill).toMatchObject({ items: [], subtotal: 0, discountAmount: 0, total: 0 });
  });

  it('rechaza un monto no entero en vez de redondearlo', () => {
    expect(() => computeBill(order([[item('entregado', 1000.5, 1)]]))).toThrow(TypeError);
    expect(() => computeBill(order([[item('entregado', 1000, 1)]], 0.5))).toThrow(TypeError);
  });

  it('devuelve los items en camelCase con nombre y precio del snapshot', () => {
    const bill = computeBill(order([[item('entregado', 5000, 2, { note: 'Sin hielo' })]]));

    expect(bill.items[0]).toMatchObject({
      productName: expect.stringMatching(/^Producto/),
      unitPrice: 5000,
      quantity: 2,
      note: 'Sin hielo',
      status: 'entregado',
      lineTotal: 10000,
    });
    expect(bill.items[0]).not.toHaveProperty('unitPriceSnapshot');
  });
});

describe('assertBillPayable', () => {
  it('un descuento mayor que el subtotal no es pagable (lo valida GC-ORD-0007)', () => {
    expect(assertBillPayable(computeBill(order([[item('entregado', 1000, 1)]], 5000)))).toBe(false);
    expect(assertBillPayable(computeBill(order([[item('entregado', 1000, 1)]], 1000)))).toBe(true);
  });
});
