import { describe, expect, it } from 'vitest';
import { historyQuerySchema } from './history.schema.js';

const UUID = '11111111-1111-4111-8111-111111111111';
const parse = (q) => historyQuerySchema.safeParse(q);

describe('historyQuerySchema: valores por defecto', () => {
  it('sin parametros: pagina 1 de 20, sin fechas (el servicio usa hoy)', () => {
    expect(parse({}).data).toEqual({ page: 1, pageSize: 20 });
  });

  it('la paginacion llega como texto en la query y se convierte a entero', () => {
    expect(parse({ page: '3', pageSize: '50' }).data).toMatchObject({ page: 3, pageSize: 50 });
  });

  it('acepta todos los filtros juntos', () => {
    const q = {
      from: '2026-11-01',
      to: '2026-11-14',
      waiterId: UUID,
      tableId: UUID,
      paymentMethodId: UUID,
    };
    expect(parse(q).success).toBe(true);
  });
});

describe('historyQuerySchema: fechas', () => {
  it('un solo dia (from === to) es valido', () => {
    expect(parse({ from: '2026-11-14', to: '2026-11-14' }).success).toBe(true);
  });

  it('366 dias contando ambos extremos es el maximo; 367 no', () => {
    expect(parse({ from: '2026-01-01', to: '2027-01-01' }).success).toBe(true); // 366 dias
    const tooLong = parse({ from: '2026-01-01', to: '2027-01-02' }); // 367 dias
    expect(tooLong.success).toBe(false);
    expect(tooLong.error.issues[0].path).toEqual(['to']);
  });

  it('from posterior a to -> error en from', () => {
    const r = parse({ from: '2026-11-15', to: '2026-11-14' });
    expect(r.success).toBe(false);
    expect(r.error.issues[0].path).toEqual(['from']);
  });

  it.each([
    ['solo from', { from: '2026-11-14' }, 'to'],
    ['solo to', { to: '2026-11-14' }, 'from'],
  ])('%s -> error: las fechas van juntas', (_label, q, field) => {
    const r = parse(q);
    expect(r.success).toBe(false);
    expect(r.error.issues[0].path).toEqual([field]);
  });

  it.each(['ayer', '2026-1-5', '2026-02-30', '2026-13-01', '14-11-2026', ''])(
    'fecha invalida %s',
    (bad) => {
      expect(parse({ from: bad, to: '2026-11-14' }).success).toBe(false);
    },
  );
});

describe('historyQuerySchema: filtros y paginacion invalidos', () => {
  it.each([
    ['waiterId no UUID', { waiterId: 'mesero1' }],
    ['tableId no UUID', { tableId: '7' }],
    ['paymentMethodId no UUID', { paymentMethodId: 'efectivo' }],
    ['page 0', { page: '0' }],
    ['page negativa', { page: '-1' }],
    ['page decimal', { page: '1.5' }],
    ['page texto', { page: 'abc' }],
    ['pageSize 0', { pageSize: '0' }],
    ['pageSize 101', { pageSize: '101' }],
    ['parametro desconocido', { status: 'CERRADA' }],
    ['date en lugar de from/to', { date: '2026-11-14' }],
  ])('%s', (_label, q) => {
    expect(parse(q).success).toBe(false);
  });
});
