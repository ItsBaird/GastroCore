import { describe, expect, it } from 'vitest';
import { toCashClose, toClosureSummary } from './cashClosure.mapper.js';

const CONFIRMED_AT = new Date('2026-11-14T23:30:00Z');
const row = (overrides = {}) => ({
  closureId: 'c1',
  closureDate: new Date('2026-11-14T00:00:00Z'),
  totalSales: 120000,
  tablesServed: 4,
  averageTicket: 30000,
  confirmedBy: 'admin-1',
  confirmedAt: CONFIRMED_AT,
  paymentBreakdown: [],
  topProducts: [],
  waiterBreakdown: [],
  ...overrides,
});

describe('toClosureSummary', () => {
  it('una fila del historial: el dia como AAAA-MM-DD, sin desgloses', () => {
    expect(toClosureSummary(row({ paymentBreakdown: [{ x: 1 }] }))).toEqual({
      closureId: 'c1',
      date: '2026-11-14',
      totalSales: 120000,
      tablesServed: 4,
      averageTicket: 30000,
      confirmedBy: 'admin-1',
      confirmedAt: CONFIRMED_AT,
    });
  });
});

describe('toCashClose', () => {
  it('devuelve el snapshot con closureId, confirmedBy y confirmedAt (forma CashClose)', () => {
    expect(toCashClose(row())).toEqual({
      date: '2026-11-14',
      totalSales: 120000,
      tablesServed: 4,
      averageTicket: 30000,
      paymentBreakdown: [],
      topProducts: [],
      waiterBreakdown: [],
      closureId: 'c1',
      confirmedBy: 'admin-1',
      confirmedAt: CONFIRMED_AT,
    });
  });

  it('ordena los desgloses como la vista previa: por monto desc (desempate por id) y el top por rank', () => {
    const out = toCashClose(
      row({
        paymentBreakdown: [
          { closureId: 'c1', paymentMethodId: 'm-b', totalAmount: 100, paymentCount: 1 },
          { closureId: 'c1', paymentMethodId: 'm-a', totalAmount: 100, paymentCount: 2 },
          { closureId: 'c1', paymentMethodId: 'm-c', totalAmount: 900, paymentCount: 3 },
        ],
        topProducts: [
          {
            closureId: 'c1',
            rank: 2,
            productId: 'p2',
            productNameSnapshot: 'Limonada',
            quantitySold: 5,
          },
          {
            closureId: 'c1',
            rank: 1,
            productId: 'p1',
            productNameSnapshot: 'Pizza',
            quantitySold: 9,
          },
        ],
        waiterBreakdown: [
          { closureId: 'c1', waiterId: 'w1', totalAmount: 10 },
          { closureId: 'c1', waiterId: 'w2', totalAmount: 50 },
        ],
      }),
    );
    expect(out.paymentBreakdown.map((p) => p.paymentMethodId)).toEqual(['m-c', 'm-a', 'm-b']);
    expect(out.topProducts).toEqual([
      { rank: 1, productId: 'p1', productName: 'Pizza', quantitySold: 9 },
      { rank: 2, productId: 'p2', productName: 'Limonada', quantitySold: 5 },
    ]);
    expect(out.waiterBreakdown).toEqual([
      { waiterId: 'w2', totalAmount: 50 },
      { waiterId: 'w1', totalAmount: 10 },
    ]);
  });

  it('no filtra columnas internas de la base (closureId de los desgloses)', () => {
    const out = toCashClose(
      row({
        paymentBreakdown: [
          { closureId: 'c1', paymentMethodId: 'm', totalAmount: 1, paymentCount: 1 },
        ],
      }),
    );
    expect(out.paymentBreakdown[0]).toEqual({
      paymentMethodId: 'm',
      totalAmount: 1,
      paymentCount: 1,
    });
  });
});
