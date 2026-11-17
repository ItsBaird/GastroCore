// GC-RPT-0002 (GC-154, GC-155): confirmCashClose. El repositorio va simulado; aqui se prueban las reglas del
// servicio: dia futuro, dia ya cerrado -> DAY_CLOSED, y que el consolidado se calcula con la misma funcion pura
// de la vista previa (sin que el cliente mande ningun total, R4).
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../repositories/cashClosure.repository.js', () => ({ confirmClosure: vi.fn() }));
vi.mock('../repositories/reports.repository.js', () => ({
  findPaymentsOfDay: vi.fn(),
  findSoldItemsOfDay: vi.fn(),
}));

const closures = await import('../repositories/cashClosure.repository.js');
const { confirmCashClose } = await import('./cashClose.service.js');

const ADMIN = { userId: 'admin-1', role: 'ADMIN', permissions: [] };
const NOW = new Date('2026-11-14T23:30:00Z'); // 18:30 del 14-nov en Colombia
const CONFIRMED_AT = new Date('2026-11-14T23:30:01Z');

beforeEach(() => {
  vi.resetAllMocks();
  closures.confirmClosure.mockImplementation(async ({ date, build, userId }) => ({
    preview: build({
      payments: [
        { total: 30000, paymentMethodId: 'm1', order: { openedBy: 'w1' } },
        { total: 10000, paymentMethodId: 'm2', order: { openedBy: 'w2' } },
      ],
      items: [],
    }),
    closure: { closureId: 'c1', confirmedBy: userId, confirmedAt: CONFIRMED_AT, closureDate: date },
  }));
});

describe('confirmCashClose', () => {
  it('pasa al repositorio el dia de negocio UTC-5, quien confirma y la funcion de calculo', async () => {
    await confirmCashClose('2026-11-14', ADMIN, NOW);
    const arg = closures.confirmClosure.mock.calls[0][0];
    expect(arg.date).toBe('2026-11-14');
    expect(arg.userId).toBe('admin-1');
    expect(arg.range).toEqual({
      start: new Date('2026-11-14T05:00:00.000Z'),
      end: new Date('2026-11-15T05:00:00.000Z'),
    });
    expect(typeof arg.build).toBe('function');
  });

  it('responde el consolidado de la vista previa mas closureId, confirmedBy y confirmedAt (CashClose)', async () => {
    const out = await confirmCashClose('2026-11-14', ADMIN, NOW);
    expect(out).toEqual({
      date: '2026-11-14',
      totalSales: 40000,
      tablesServed: 2,
      averageTicket: 20000,
      paymentBreakdown: [
        { paymentMethodId: 'm1', totalAmount: 30000, paymentCount: 1 },
        { paymentMethodId: 'm2', totalAmount: 10000, paymentCount: 1 },
      ],
      topProducts: [],
      waiterBreakdown: [
        { waiterId: 'w1', totalAmount: 30000 },
        { waiterId: 'w2', totalAmount: 10000 },
      ],
      closureId: 'c1',
      confirmedBy: 'admin-1',
      confirmedAt: CONFIRMED_AT,
    });
  });

  it('criterio 2: si el dia ya estaba cerrado -> 409 DAY_CLOSED con la fecha', async () => {
    closures.confirmClosure.mockResolvedValue({ alreadyClosed: true });
    await expect(confirmCashClose('2026-11-14', ADMIN, NOW)).rejects.toMatchObject({
      status: 409,
      code: 'DAY_CLOSED',
      details: { date: '2026-11-14' },
    });
  });

  it('se puede cerrar el dia en curso y cualquier dia pasado', async () => {
    await expect(confirmCashClose('2026-11-14', ADMIN, NOW)).resolves.toBeDefined();
    await expect(confirmCashClose('2025-01-01', ADMIN, NOW)).resolves.toBeDefined();
  });

  it('un dia futuro -> 400 VALIDATION_ERROR y no toca la base', async () => {
    await expect(confirmCashClose('2026-11-15', ADMIN, NOW)).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      details: { field: 'date', today: '2026-11-14' },
    });
    expect(closures.confirmClosure).not.toHaveBeenCalled();
  });

  it('el "hoy" es el de Colombia: a las 20:00 de Neiva del 14 (01:00 UTC del 15) el 15 sigue siendo futuro', async () => {
    const night = new Date('2026-11-15T01:00:00Z');
    await expect(confirmCashClose('2026-11-15', ADMIN, night)).rejects.toMatchObject({
      status: 400,
    });
    await expect(confirmCashClose('2026-11-14', ADMIN, night)).resolves.toBeDefined();
  });

  it('un error de la base se propaga', async () => {
    closures.confirmClosure.mockRejectedValue(new Error('db down'));
    await expect(confirmCashClose('2026-11-14', ADMIN, NOW)).rejects.toThrow('db down');
  });
});
