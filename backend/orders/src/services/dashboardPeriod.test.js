import { describe, expect, it } from 'vitest';
import {
  addDays,
  businessDayOf,
  currentWeek,
  daysInclusive,
  listDays,
  periodRange,
  resolvePeriods,
} from './dashboardPeriod.js';

// 2026-11-09 y 2026-11-16 son lunes; 2026-11-15 y 2026-11-22, domingos
describe('dashboardPeriod: dia de negocio Colombia (UTC-5)', () => {
  it('a las 23:30 de Neiva sigue siendo el mismo dia aunque en UTC ya sea el siguiente', () => {
    expect(businessDayOf(new Date('2026-11-16T04:30:00Z'))).toBe('2026-11-15');
    expect(businessDayOf(new Date('2026-11-16T05:10:00Z'))).toBe('2026-11-16');
  });

  it('semana en curso de lunes a domingo, en hora de Colombia', () => {
    // domingo 15 a las 23:30 en Neiva: aun es la semana del 9 al 15
    expect(currentWeek(new Date('2026-11-16T04:30:00Z'))).toEqual({
      from: '2026-11-09',
      to: '2026-11-15',
    });
    // lunes 16 a las 00:10 en Neiva: empieza la semana del 16 al 22
    expect(currentWeek(new Date('2026-11-16T05:10:00Z'))).toEqual({
      from: '2026-11-16',
      to: '2026-11-22',
    });
    // un miercoles cualquiera
    expect(currentWeek(new Date('2026-11-18T17:00:00Z'))).toEqual({
      from: '2026-11-16',
      to: '2026-11-22',
    });
  });

  it('sin from/to usa la semana en curso y la compara con la semana anterior completa', () => {
    expect(resolvePeriods({}, new Date('2026-11-18T17:00:00Z'))).toEqual({
      period: { from: '2026-11-16', to: '2026-11-22' },
      previousPeriod: { from: '2026-11-09', to: '2026-11-15' },
    });
  });

  it('el periodo anterior tiene la misma duracion y termina el dia previo a from', () => {
    expect(resolvePeriods({ from: '2026-11-10', to: '2026-11-10' }).previousPeriod).toEqual({
      from: '2026-11-09',
      to: '2026-11-09',
    });
    expect(resolvePeriods({ from: '2026-03-01', to: '2026-03-03' }).previousPeriod).toEqual({
      from: '2026-02-26',
      to: '2026-02-28',
    });
  });

  it('cuenta los dias con ambos extremos y los lista todos', () => {
    expect(daysInclusive('2026-11-10', '2026-11-10')).toBe(1);
    expect(daysInclusive('2026-01-01', '2026-04-02')).toBe(92);
    expect(listDays({ from: '2026-02-27', to: '2026-03-02' })).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('el rango UTC va del inicio del primer dia al fin del ultimo, exclusivo', () => {
    expect(periodRange({ from: '2026-11-09', to: '2026-11-15' })).toEqual({
      start: new Date('2026-11-09T05:00:00Z'),
      end: new Date('2026-11-16T05:00:00Z'),
    });
  });
});
