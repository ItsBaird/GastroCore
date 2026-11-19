// GC-RPT-0003 (GC-190). Servicio de exportacion: tope de filas, filtros, nombres desde Staff y el .xlsx real
// (write-excel-file sin simular). El repositorio y Staff van simulados.
import { strFromU8, unzipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../repositories/history.repository.js', () => ({
  findHistoryPage: vi.fn(),
  findHistoryOrder: vi.fn(),
  findHistoryForExport: vi.fn(),
  aggregateHistory: vi.fn(),
}));
vi.mock('../clients/staffClient.js', () => ({
  staffClient: { getEmployeeNames: vi.fn(), hasActiveShift: vi.fn() },
}));

const repo = await import('../repositories/history.repository.js');
const { staffClient } = await import('../clients/staffClient.js');
const { exportSalesHistory } = await import('./historyExport.service.js');

const NOW = new Date('2026-11-15T01:00:00Z'); // 8:00 p. m. del 14 en Colombia
const order = (i, waiter = 'w-1') => ({
  orderId: `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`,
  tableId: 't-1',
  openedBy: waiter,
  openedAt: new Date('2026-11-14T17:00:00Z'),
  closedAt: new Date('2026-11-14T19:00:00Z'),
  table: { tableNumber: 4 },
  payment: {
    subtotal: 30000,
    discountAmount: 0,
    total: 30000,
    paymentMethodId: 'm-1',
    paymentMethod: { name: 'Tarjeta' },
  },
  rounds: [{ items: [{ quantity: 2 }] }],
});

function sheetXml(buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  return {
    workbook: strFromU8(files['xl/workbook.xml']),
    sheet: strFromU8(files['xl/worksheets/sheet1.xml']),
    strings: strFromU8(files['xl/sharedStrings.xml']),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  repo.aggregateHistory.mockResolvedValue({ totalSales: 30000, ordersCount: 1 });
  repo.findHistoryForExport.mockResolvedValue([order(1)]);
  staffClient.getEmployeeNames.mockResolvedValue(new Map([['w-1', 'Laura Gómez']]));
});

describe('exportSalesHistory: tope de filas', () => {
  it('mas de 10000 ventas -> 422 EXPORT_TOO_LARGE, sin leer las filas ni llamar a Staff', async () => {
    repo.aggregateHistory.mockResolvedValue({ totalSales: 1, ordersCount: 10001 });
    await expect(exportSalesHistory({}, NOW)).rejects.toMatchObject({
      status: 422,
      code: 'EXPORT_TOO_LARGE',
      details: { rows: 10001, max: 10000 },
    });
    expect(repo.findHistoryForExport).not.toHaveBeenCalled();
    expect(staffClient.getEmployeeNames).not.toHaveBeenCalled();
  });

  it('exactamente 10000 si se exporta', async () => {
    repo.aggregateHistory.mockResolvedValue({ totalSales: 1, ordersCount: 10000 });
    await expect(exportSalesHistory({}, NOW)).resolves.toHaveProperty('buffer');
  });
});

describe('exportSalesHistory: filtros y nombre del archivo', () => {
  it('sin fechas exporta el dia de negocio ACTUAL (Colombia) y el archivo lleva ese dia', async () => {
    const out = await exportSalesHistory({}, NOW);
    expect(out.fileName).toBe('ventas_2026-11-14_2026-11-14.xlsx');
    expect(repo.findHistoryForExport).toHaveBeenCalledWith({
      start: new Date('2026-11-14T05:00:00Z'),
      end: new Date('2026-11-15T05:00:00Z'),
      waiterId: undefined,
      tableId: undefined,
      paymentMethodId: undefined,
    });
  });

  it('usa los MISMOS filtros para contar y para leer las filas', async () => {
    const q = {
      from: '2026-11-01',
      to: '2026-11-14',
      waiterId: 'w',
      tableId: 't',
      paymentMethodId: 'm',
    };
    const out = await exportSalesHistory(q, NOW);
    expect(out.fileName).toBe('ventas_2026-11-01_2026-11-14.xlsx');
    const expected = {
      start: new Date('2026-11-01T05:00:00Z'),
      end: new Date('2026-11-15T05:00:00Z'),
      waiterId: 'w',
      tableId: 't',
      paymentMethodId: 'm',
    };
    expect(repo.aggregateHistory).toHaveBeenCalledWith(expected);
    expect(repo.findHistoryForExport).toHaveBeenCalledWith(expected);
  });
});

describe('exportSalesHistory: nombres de los meseros', () => {
  it('pide a Staff cada mesero UNA vez aunque tenga varias ventas', async () => {
    repo.findHistoryForExport.mockResolvedValue([order(1), order(2), order(3, 'w-2')]);
    await exportSalesHistory({}, NOW);
    expect(staffClient.getEmployeeNames).toHaveBeenCalledTimes(1);
    expect(staffClient.getEmployeeNames.mock.calls[0][0]).toEqual(['w-1', 'w-2']);
  });

  it('con mas de 100 meseros los pide en lotes de 100 (el limite de Staff)', async () => {
    repo.findHistoryForExport.mockResolvedValue(
      Array.from({ length: 250 }, (_, i) => order(i, `w-${i}`)),
    );
    repo.aggregateHistory.mockResolvedValue({ totalSales: 250 * 30000, ordersCount: 250 });
    staffClient.getEmployeeNames.mockResolvedValue(new Map());
    await exportSalesHistory({}, NOW);
    expect(staffClient.getEmployeeNames.mock.calls.map((c) => c[0].length)).toEqual([100, 100, 50]);
  });

  it('si Staff no responde (Map vacio) el archivo se genera igual con "Sin perfil de empleado"', async () => {
    staffClient.getEmployeeNames.mockResolvedValue(new Map());
    const { buffer } = await exportSalesHistory({}, NOW);
    expect(sheetXml(buffer).strings).toContain('Sin perfil de empleado');
  });
});

describe('exportSalesHistory: el archivo', () => {
  it('es un .xlsx real (zip) con la hoja "Ventas", el encabezado fijo y los datos', async () => {
    const { buffer } = await exportSalesHistory({}, NOW);
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    const xml = sheetXml(buffer);
    expect(xml.workbook).toMatch(/<sheet [^>]*name="Ventas"/);
    expect(xml.sheet).toContain('state="frozen"');
    for (const text of [
      'Referencia',
      'Método de pago',
      'AAAAAA',
      'Laura Gómez',
      'Tarjeta',
      'Total (1 ventas)',
    ]) {
      expect(xml.strings).toContain(text);
    }
    expect(xml.sheet).toContain('<v>30000</v>');
  });
});
