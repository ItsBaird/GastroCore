// GC-RPT-0003 (GC-190). Contenido de la hoja de Excel del historial de ventas. Es una funcion pura (no toca la
// base, la red ni el reloj): recibe las filas ya calculadas y los nombres, y devuelve las celdas para
// write-excel-file. Asi cada regla del archivo se prueba sin generar un .xlsx.

export const SHEET_NAME = 'Ventas';
export const MAX_EXPORT_ROWS = 10000;
export const UNKNOWN_WAITER = 'Sin perfil de empleado';

// Pesos colombianos enteros (R5): "$" y separador de miles, sin decimales. Excel muestra el separador segun su
// idioma (en espanol, $ 1.234.567); el valor sigue siendo un NUMERO, asi que se puede sumar y filtrar.
const COP_FORMAT = '"$"#,##0';
const DATE_FORMAT = 'dd/mm/yyyy hh:mm';
const OFFSET_MS = 5 * 60 * 60 * 1000;

export const HEADERS = [
  'Referencia',
  'Fecha cierre',
  'Mesa',
  'Mesero',
  'Productos',
  'Subtotal',
  'Descuento',
  'Total',
  'Método de pago',
];

// Ancho de cada columna en caracteres (mismo orden que HEADERS)
export const COLUMNS = [12, 18, 8, 28, 11, 14, 14, 14, 24].map((width) => ({ width }));

// Excel no guarda zona horaria: una fecha se muestra tal cual se escribe. Se escribe la hora de COLOMBIA (UTC-5),
// que es la del restaurante, para que una venta de las 8:00 p. m. no aparezca a la 01:00 del dia siguiente.
export function toColombiaClock(instant) {
  return new Date(instant.getTime() - OFFSET_MS);
}

const header = (value) => ({ value, fontWeight: 'bold', backgroundColor: '#F5F5F5' });
const money = (value, bold = false) => ({
  value,
  type: Number,
  format: COP_FORMAT,
  ...(bold && { fontWeight: 'bold' }),
});

// `rows`: filas del historial (HistoryOrder) con `paymentMethodName`. `waiterNames`: Map userId -> nombre.
// `summary`: el resumen del mismo filtro; la fila de totales usa sus ventas para que coincidan exactamente.
export function buildSalesSheet({ rows, waiterNames, summary }) {
  const body = rows.map((row) => [
    { value: row.reference, type: String },
    { value: toColombiaClock(row.closedAt), type: Date, format: DATE_FORMAT },
    { value: row.tableNumber, type: Number },
    { value: waiterNames.get(row.waiterId) ?? UNKNOWN_WAITER, type: String },
    { value: row.itemsCount, type: Number },
    money(row.subtotal),
    money(row.discountAmount),
    money(row.total),
    { value: row.paymentMethodName, type: String },
  ]);

  const sum = (key) => rows.reduce((acc, row) => acc + row[key], 0);
  const totals = [
    { value: `Total (${summary.ordersCount} ventas)`, fontWeight: 'bold', columnSpan: 4 },
    null,
    null,
    null,
    { value: sum('itemsCount'), type: Number, fontWeight: 'bold' },
    money(sum('subtotal'), true),
    money(sum('discountAmount'), true),
    money(summary.totalSales, true),
    null,
  ];

  return [HEADERS.map(header), ...body, totals];
}

// ventas_AAAA-MM-DD_AAAA-MM-DD.xlsx (el rango de dias de negocio exportado)
export function exportFileName(from, to) {
  return `ventas_${from}_${to}.xlsx`;
}
