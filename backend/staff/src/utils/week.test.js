import { describe, expect, it } from 'vitest';
import { weekRange } from './week.js';

const iso = (range) => [range.start.toISOString(), range.end.toISOString()];

describe('weekRange (lunes a domingo, hora de Colombia UTC-5)', () => {
  // 2026-11-02 es lunes y 2026-11-08 es domingo
  it.each([
    ['lunes', '2026-11-02'],
    ['miercoles', '2026-11-04'],
    ['viernes', '2026-11-06'],
    ['sabado', '2026-11-07'],
    ['domingo', '2026-11-08'],
  ])('un %s cae en la semana del lunes 2 al domingo 8 de noviembre', (_day, date) => {
    expect(iso(weekRange(date))).toEqual(['2026-11-02T05:00:00.000Z', '2026-11-09T05:00:00.000Z']);
  });

  it('el lunes siguiente ya es otra semana', () => {
    expect(iso(weekRange('2026-11-09'))).toEqual([
      '2026-11-09T05:00:00.000Z',
      '2026-11-16T05:00:00.000Z',
    ]);
  });

  it('el rango dura exactamente 7 dias y es semiabierto [inicio, fin)', () => {
    const { start, end } = weekRange('2026-11-06');
    expect(end.getTime() - start.getTime()).toBe(7 * 24 * 3600 * 1000);
  });

  it('un turno de domingo 9 p. m. (hora Colombia) pertenece a esa semana, no a la siguiente', () => {
    const { start, end } = weekRange('2026-11-08');
    const sundayNight = new Date('2026-11-09T02:00:00Z'); // domingo 21:00 en Colombia
    expect(sundayNight >= start && sundayNight < end).toBe(true);
  });

  it('el lunes a medianoche (hora Colombia) abre la semana y el instante anterior no', () => {
    const { start } = weekRange('2026-11-04');
    expect(start.toISOString()).toBe('2026-11-02T05:00:00.000Z'); // lunes 00:00 -05:00
    expect(new Date(start.getTime() - 1) < start).toBe(true);
  });

  it('cruza el cambio de ano', () => {
    // 2026-12-31 es jueves: la semana empieza el lunes 28 de diciembre
    expect(iso(weekRange('2026-12-31'))).toEqual([
      '2026-12-28T05:00:00.000Z',
      '2027-01-04T05:00:00.000Z',
    ]);
    expect(iso(weekRange('2027-01-01'))[0]).toBe('2026-12-28T05:00:00.000Z');
  });

  it('funciona en ano bisiesto', () => {
    // 2028-02-29 es martes: la semana empieza el lunes 28 de febrero
    expect(iso(weekRange('2028-02-29'))).toEqual([
      '2028-02-28T05:00:00.000Z',
      '2028-03-06T05:00:00.000Z',
    ]);
  });
});
