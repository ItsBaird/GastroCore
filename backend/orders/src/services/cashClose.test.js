import { describe, expect, it } from 'vitest';
import { TOP_PRODUCTS, buildCashClosePreview } from './cashClose.js';

const M_CASH = '00000000-0000-4000-8000-0000000000a1';
const M_CARD = '00000000-0000-4000-8000-0000000000a2';
const M_NEQUI = '00000000-0000-4000-8000-0000000000a3';
const W1 = '00000000-0000-4000-8000-0000000000b1';
const W2 = '00000000-0000-4000-8000-0000000000b2';
const DATE = '2026-11-14';

const pay = (total, method = M_CASH, openedBy = W1) => ({
  total,
  paymentMethodId: method,
  order: { openedBy },
});
const pid = (n) => `00000000-0000-4000-8000-00000000c${String(n).padStart(3, '0')}`;
const line = (n, name, quantity, unitPrice, at = '2026-11-14T15:00:00Z') => ({
  productId: pid(n),
  productNameSnapshot: name,
  quantity,
  unitPriceSnapshot: unitPrice,
  createdAt: new Date(at),
});
const build = (payments = [], items = []) => buildCashClosePreview({ date: DATE, payments, items });

describe('sin ordenes cerradas', () => {
  it('todos los totales en 0 y las listas vacias, con la fecha pedida (contrato)', () => {
    expect(build()).toEqual({
      date: DATE,
      totalSales: 0,
      tablesServed: 0,
      averageTicket: 0,
      paymentBreakdown: [],
      topProducts: [],
      waiterBreakdown: [],
    });
  });
});

describe('total de ventas, mesas atendidas y ticket promedio', () => {
  it('el total es la suma de lo cobrado y cada pago es una cuenta cerrada (una mesa atendida)', () => {
    const out = build([pay(28000), pay(15000, M_CARD), pay(32000, M_CASH, W2)]);
    expect(out.totalSales).toBe(75000);
    expect(out.tablesServed).toBe(3);
    expect(out.averageTicket).toBe(25000);
  });

  it('el ticket promedio es entero: se redondea al mas cercano (R5)', () => {
    expect(build([pay(10), pay(0), pay(0)]).averageTicket).toBe(3); // 3,33
    expect(build([pay(10), pay(10), pay(0)]).averageTicket).toBe(7); // 6,67
    expect(build([pay(3), pay(2)]).averageTicket).toBe(3); // 2,5 sube
  });

  it('una cuenta de total 0 (descuento igual al subtotal) cuenta como mesa atendida y baja el promedio', () => {
    const out = build([pay(20000), pay(0)]);
    expect(out.tablesServed).toBe(2);
    expect(out.totalSales).toBe(20000);
    expect(out.averageTicket).toBe(10000);
  });
});

describe('desglose por metodo de pago', () => {
  it('agrupa por metodo con lo cobrado y cuantos pagos, mayor monto primero', () => {
    const out = build([
      pay(10000, M_CASH),
      pay(50000, M_CARD),
      pay(20000, M_CASH),
      pay(5000, M_NEQUI),
    ]);
    expect(out.paymentBreakdown).toEqual([
      { paymentMethodId: M_CARD, totalAmount: 50000, paymentCount: 1 },
      { paymentMethodId: M_CASH, totalAmount: 30000, paymentCount: 2 },
      { paymentMethodId: M_NEQUI, totalAmount: 5000, paymentCount: 1 },
    ]);
  });

  it('con el mismo monto desempata por id del metodo, siempre en el mismo orden', () => {
    const out = build([pay(1000, M_NEQUI), pay(1000, M_CASH), pay(1000, M_CARD)]);
    expect(out.paymentBreakdown.map((r) => r.paymentMethodId)).toEqual([M_CASH, M_CARD, M_NEQUI]);
  });

  it('los metodos sin pagos ese dia no aparecen y la suma del desglose es el total de ventas', () => {
    const out = build([pay(7000, M_CARD), pay(3000, M_CARD)]);
    expect(out.paymentBreakdown).toHaveLength(1);
    expect(out.paymentBreakdown.reduce((s, r) => s + r.totalAmount, 0)).toBe(out.totalSales);
  });

  it('solo trae los campos del contrato', () => {
    const [row] = build([pay(1000)]).paymentBreakdown;
    expect(Object.keys(row).sort()).toEqual(['paymentCount', 'paymentMethodId', 'totalAmount']);
  });
});

describe('ingresos por mesero (atribuidos al que abrio la mesa)', () => {
  it('suma lo cobrado de las ordenes que abrio cada mesero, mayor monto primero', () => {
    const out = build([pay(10000, M_CASH, W1), pay(40000, M_CARD, W2), pay(5000, M_CASH, W1)]);
    expect(out.waiterBreakdown).toEqual([
      { waiterId: W2, totalAmount: 40000 },
      { waiterId: W1, totalAmount: 15000 },
    ]);
  });

  it('la suma por mesero tambien es el total de ventas', () => {
    const out = build([pay(1234, M_CASH, W1), pay(4321, M_CARD, W2), pay(1, M_CASH, W2)]);
    expect(out.waiterBreakdown.reduce((s, r) => s + r.totalAmount, 0)).toBe(out.totalSales);
  });
});

describe('top 5 de platos vendidos', () => {
  it('ordena por unidades vendidas y numera del 1 al 5', () => {
    const out = build(
      [],
      [line(1, 'Pizza', 10, 28000), line(2, 'Limonada', 30, 7000), line(3, 'Pasta', 20, 25000)],
    );
    expect(out.topProducts).toEqual([
      { rank: 1, productId: pid(2), productName: 'Limonada', quantitySold: 30 },
      { rank: 2, productId: pid(3), productName: 'Pasta', quantitySold: 20 },
      { rank: 3, productId: pid(1), productName: 'Pizza', quantitySold: 10 },
    ]);
  });

  it(`se queda con los ${TOP_PRODUCTS} primeros aunque se vendan mas productos`, () => {
    const items = Array.from({ length: 8 }, (_, i) => line(i + 1, `Plato ${i + 1}`, 10 + i, 1000));
    const out = build([], items);
    expect(out.topProducts).toHaveLength(5);
    expect(out.topProducts.map((p) => p.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(out.topProducts[0].productName).toBe('Plato 8');
  });

  it('suma las unidades de un mismo producto aunque salga en varias lineas, rondas o mesas', () => {
    const out = build(
      [],
      [line(1, 'Pizza', 2, 28000), line(1, 'Pizza', 3, 28000), line(2, 'Pasta', 4, 25000)],
    );
    expect(out.topProducts[0]).toMatchObject({ productName: 'Pizza', quantitySold: 5 });
  });

  it('con las mismas unidades gana el de mas ingreso; si tambien empatan, el nombre', () => {
    const porIngreso = build([], [line(1, 'Barato', 5, 1000), line(2, 'Caro', 5, 9000)]);
    expect(porIngreso.topProducts.map((p) => p.productName)).toEqual(['Caro', 'Barato']);

    const porNombre = build([], [line(1, 'Zumo', 5, 2000), line(2, 'Agua', 5, 2000)]);
    expect(porNombre.topProducts.map((p) => p.productName)).toEqual(['Agua', 'Zumo']);
  });

  it('el desempate es estable aunque lleguen en otro orden', () => {
    const a = build([], [line(1, 'A', 5, 1000), line(2, 'B', 5, 1000)]);
    const b = build([], [line(2, 'B', 5, 1000), line(1, 'A', 5, 1000)]);
    expect(a.topProducts).toEqual(b.topProducts);
  });

  it('usa el nombre del snapshot MAS RECIENTE si el plato cambio de nombre', () => {
    const out = build(
      [],
      [
        line(1, 'Pizza Margarita', 2, 28000, '2026-11-14T13:00:00Z'),
        line(1, 'Pizza Margherita', 1, 28000, '2026-11-14T19:00:00Z'),
        line(1, 'Pizza Margarita', 4, 28000, '2026-11-14T15:00:00Z'),
      ],
    );
    expect(out.topProducts[0]).toMatchObject({ productName: 'Pizza Margherita', quantitySold: 7 });
  });

  it('solo trae los campos del contrato (sin ingreso ni otros datos internos)', () => {
    const [row] = build([], [line(1, 'Pizza', 1, 28000)]).topProducts;
    expect(Object.keys(row).sort()).toEqual(['productId', 'productName', 'quantitySold', 'rank']);
  });
});

describe('un dia completo', () => {
  it('consolida pagos e items en la forma del contrato', () => {
    const out = build(
      [
        pay(56000, M_CASH, W1),
        pay(32000, M_CARD, W2),
        pay(25000, M_CASH, W1),
        pay(7000, M_NEQUI, W2),
      ],
      [
        line(1, 'Pizza Margarita', 2, 28000),
        line(2, 'Pizza Pepperoni', 1, 32000),
        line(3, 'Pasta Carbonara', 1, 25000),
        line(4, 'Limonada', 1, 7000),
      ],
    );
    expect(out).toEqual({
      date: DATE,
      totalSales: 120000,
      tablesServed: 4,
      averageTicket: 30000,
      paymentBreakdown: [
        { paymentMethodId: M_CASH, totalAmount: 81000, paymentCount: 2 },
        { paymentMethodId: M_CARD, totalAmount: 32000, paymentCount: 1 },
        { paymentMethodId: M_NEQUI, totalAmount: 7000, paymentCount: 1 },
      ],
      topProducts: [
        { rank: 1, productId: pid(1), productName: 'Pizza Margarita', quantitySold: 2 },
        { rank: 2, productId: pid(2), productName: 'Pizza Pepperoni', quantitySold: 1 },
        { rank: 3, productId: pid(3), productName: 'Pasta Carbonara', quantitySold: 1 },
        { rank: 4, productId: pid(4), productName: 'Limonada', quantitySold: 1 },
      ],
      waiterBreakdown: [
        { waiterId: W1, totalAmount: 81000 },
        { waiterId: W2, totalAmount: 39000 },
      ],
    });
  });
});

describe('GC-151: la venta se atribuye al mesero que ABRIO la mesa (opened_by)', () => {
  const W3 = '00000000-0000-4000-8000-0000000000b3';
  // Lo que podria llegar si el repositorio trajera mas columnas: debe ignorarse todo menos opened_by
  const withOthers = (total, { openedBy, waiterId, registeredBy }) => ({
    total,
    paymentMethodId: M_CASH,
    registeredBy,
    order: { openedBy, waiterId },
  });

  it('una mesa reasignada a otro mesero sigue siendo venta de quien la abrio', () => {
    // W1 abrio la mesa; un administrador la reasigno a W2 (cambia waiter_id, no opened_by); W2 cobro
    const out = build([withOthers(50000, { openedBy: W1, waiterId: W2, registeredBy: W2 })]);
    expect(out.waiterBreakdown).toEqual([{ waiterId: W1, totalAmount: 50000 }]);
  });

  it('quien registra el pago (un tercero, o el ADMIN) no recibe la venta', () => {
    const out = build([withOthers(30000, { openedBy: W1, waiterId: W1, registeredBy: W3 })]);
    expect(out.waiterBreakdown).toEqual([{ waiterId: W1, totalAmount: 30000 }]);
    expect(out.waiterBreakdown.map((w) => w.waiterId)).not.toContain(W3);
  });

  it('suma varias mesas del mismo mesero aunque algunas se hayan reasignado y otras no', () => {
    const out = build([
      withOthers(20000, { openedBy: W1, waiterId: W1, registeredBy: W1 }),
      withOthers(10000, { openedBy: W1, waiterId: W2, registeredBy: W2 }),
      withOthers(5000, { openedBy: W2, waiterId: W1, registeredBy: W1 }),
    ]);
    expect(out.waiterBreakdown).toEqual([
      { waiterId: W1, totalAmount: 30000 },
      { waiterId: W2, totalAmount: 5000 },
    ]);
  });

  it('si el ADMIN abrio la mesa, la venta es del ADMIN (sale en el desglose como cualquier otro)', () => {
    const ADMIN = '00000000-0000-4000-8000-0000000000ad';
    const out = build([pay(12000, M_CASH, ADMIN), pay(8000, M_CARD, W1)]);
    expect(out.waiterBreakdown).toEqual([
      { waiterId: ADMIN, totalAmount: 12000 },
      { waiterId: W1, totalAmount: 8000 },
    ]);
  });

  it('cada venta se atribuye a UN solo mesero: la suma del desglose es exactamente el total de ventas', () => {
    const payments = [
      withOthers(1111, { openedBy: W1, waiterId: W2, registeredBy: W3 }),
      withOthers(2222, { openedBy: W2, waiterId: W3, registeredBy: W1 }),
      withOthers(3333, { openedBy: W3, waiterId: W1, registeredBy: W2 }),
    ];
    const out = build(payments);
    expect(out.waiterBreakdown.reduce((s, w) => s + w.totalAmount, 0)).toBe(out.totalSales);
    expect(out.waiterBreakdown).toHaveLength(3);
  });

  it('un dia sin ordenes no tiene desglose por mesero', () => {
    expect(build().waiterBreakdown).toEqual([]);
  });
});
