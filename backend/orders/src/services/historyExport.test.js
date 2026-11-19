import { describe, expect, it } from 'vitest';
import {
  buildSalesSheet,
  COLUMNS,
  exportFileName,
  HEADERS,
  MAX_EXPORT_ROWS,
  toColombiaClock,
  UNKNOWN_WAITER,
} from './historyExport.js';

const W1 = 'w-1';
const W2 = 'w-2';
const row = (overrides = {}) => ({
  orderId: '3f9a1c7e-0b2d-4e5f-8a9b-1c2d3e4f5a6b',
  reference: '3F9A1C',
  tableId: 't-1',
  tableNumber: 7,
  waiterId: W1,
  openedAt: new Date('2026-11-15T00:00:00Z'),
  closedAt: new Date('2026-11-15T01:00:00Z'), // 8:00 p. m. del 14 en Colombia
  itemsCount: 3,
  subtotal: 100000,
  discountAmount: 10000,
  total: 90000,
  paymentMethodId: 'm-1',
  paymentMethodName: 'Efectivo',
  ...overrides,
});
const names = new Map([
  [W1, 'Laura Gómez'],
  [W2, 'Carlos Ruiz'],
]);
const summaryOf = (rows) => ({
  totalSales: rows.reduce((s, r) => s + r.total, 0),
  ordersCount: rows.length,
  averageTicket: 0,
});
const sheetOf = (rows) => buildSalesSheet({ rows, waiterNames: names, summary: summaryOf(rows) });
const values = (cells) => cells.map((c) => (c === null ? null : c.value));

describe('buildSalesSheet: encabezado', () => {
  it('la primera fila son las 9 columnas del contrato, en negrilla', () => {
    const [head] = sheetOf([row()]);
    expect(values(head)).toEqual([
      'Referencia',
      'Fecha cierre',
      'Mesa',
      'Mesero',
      'Productos',
      'Subtotal',
      'Descuento',
      'Total',
      'Método de pago',
    ]);
    expect(head.every((c) => c.fontWeight === 'bold')).toBe(true);
    expect(COLUMNS).toHaveLength(HEADERS.length);
  });
});

describe('buildSalesSheet: una fila por venta', () => {
  it('referencia, fecha, numero de mesa, NOMBRE del mesero, unidades, montos y NOMBRE del metodo', () => {
    const [, line] = sheetOf([row()]);
    expect(values(line)).toEqual([
      '3F9A1C',
      new Date('2026-11-14T20:00:00Z'),
      7,
      'Laura Gómez',
      3,
      100000,
      10000,
      90000,
      'Efectivo',
    ]);
  });

  it('la fecha se escribe en hora de Colombia (Excel no guarda zona horaria)', () => {
    const [, line] = sheetOf([row()]);
    expect(line[1]).toMatchObject({ type: Date, format: 'dd/mm/yyyy hh:mm' });
    // 01:00 UTC del 15 = 8:00 p. m. del 14 en Colombia: el reloj escrito es el de Colombia
    expect(line[1].value.toISOString()).toBe('2026-11-14T20:00:00.000Z');
  });

  it('los montos son NUMEROS con formato de pesos (se pueden sumar en Excel), no texto', () => {
    const [, line] = sheetOf([row()]);
    for (const cell of line.slice(5, 8)) {
      expect(cell.type).toBe(Number);
      expect(typeof cell.value).toBe('number');
      expect(cell.format).toBe('"$"#,##0');
    }
    expect(line[2].type).toBe(Number); // la mesa tambien es numero
    expect(line[4].type).toBe(Number); // y las unidades
  });

  it('un mesero sin nombre en Staff sale como "Sin perfil de empleado"', () => {
    const [, line] = sheetOf([row({ waiterId: 'desconocido' })]);
    expect(line[3].value).toBe(UNKNOWN_WAITER);
  });

  it('respeta el orden de las ventas que recibe (el del listado)', () => {
    const sheet = sheetOf([
      row({ reference: 'AAAAAA' }),
      row({ reference: 'BBBBBB', waiterId: W2 }),
    ]);
    expect(sheet.slice(1, -1).map((r) => r[0].value)).toEqual(['AAAAAA', 'BBBBBB']);
  });
});

describe('buildSalesSheet: fila final de totales', () => {
  it('suma unidades, subtotal, descuento y total, y el total es el del RESUMEN', () => {
    const rows = [row(), row({ itemsCount: 2, subtotal: 50000, discountAmount: 0, total: 50000 })];
    const sheet = sheetOf(rows);
    const totals = sheet.at(-1);
    expect(sheet).toHaveLength(1 + 2 + 1);
    expect(values(totals)).toEqual([
      'Total (2 ventas)',
      null,
      null,
      null,
      5,
      150000,
      10000,
      140000,
      null,
    ]);
    expect(totals[0]).toMatchObject({ fontWeight: 'bold', columnSpan: 4 });
    expect(totals[7]).toMatchObject({ type: Number, format: '"$"#,##0', fontWeight: 'bold' });
  });

  it('el total de la fila final viene del resumen del filtro (asi coincide con el que ve la pantalla)', () => {
    const sheet = buildSalesSheet({
      rows: [row()],
      waiterNames: names,
      summary: { totalSales: 90000, ordersCount: 1, averageTicket: 90000 },
    });
    expect(sheet.at(-1)[7].value).toBe(90000);
  });

  it('sin ventas: encabezado y una fila de totales en cero', () => {
    const sheet = sheetOf([]);
    expect(sheet).toHaveLength(2);
    expect(values(sheet[1])).toEqual(['Total (0 ventas)', null, null, null, 0, 0, 0, 0, null]);
  });
});

describe('utilidades', () => {
  it('toColombiaClock resta 5 horas', () => {
    expect(toColombiaClock(new Date('2026-11-15T05:00:00Z')).toISOString()).toBe(
      '2026-11-15T00:00:00.000Z',
    );
  });

  it('nombre del archivo: ventas_AAAA-MM-DD_AAAA-MM-DD.xlsx', () => {
    expect(exportFileName('2026-11-01', '2026-11-14')).toBe('ventas_2026-11-01_2026-11-14.xlsx');
  });

  it('el maximo es 10000 filas', () => {
    expect(MAX_EXPORT_ROWS).toBe(10000);
  });
});
