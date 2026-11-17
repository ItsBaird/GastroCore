import { describe, expect, it } from 'vitest';
import { businessDateOf, businessDayRange } from './businessDay.js';

describe('businessDayRange', () => {
  it('el dia de negocio es UTC-5: del 14-nov va de las 05:00 UTC del 14 a las 05:00 UTC del 15', () => {
    const { start, end } = businessDayRange('2026-11-14');
    expect(start.toISOString()).toBe('2026-11-14T05:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-15T05:00:00.000Z');
  });

  it('dura exactamente 24 horas', () => {
    const { start, end } = businessDayRange('2026-03-08');
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('dos dias seguidos no se solapan ni dejan huecos', () => {
    const a = businessDayRange('2026-11-14');
    const b = businessDayRange('2026-11-15');
    expect(a.end.getTime()).toBe(b.start.getTime());
  });

  it('una venta de las 8 p. m. en Neiva (01:00 UTC del dia siguiente) es del dia de negocio, no del siguiente', () => {
    const closedAt = new Date('2026-11-15T01:00:00Z'); // 20:00 del 14-nov en Colombia
    const day14 = businessDayRange('2026-11-14');
    const day15 = businessDayRange('2026-11-15');
    expect(closedAt >= day14.start && closedAt < day14.end).toBe(true);
    expect(closedAt >= day15.start && closedAt < day15.end).toBe(false);
  });

  it('el limite es exclusivo: justo a medianoche en Colombia ya es el dia siguiente', () => {
    const midnight = new Date('2026-11-15T05:00:00Z'); // 00:00 del 15-nov en Colombia
    expect(midnight < businessDayRange('2026-11-14').end).toBe(false);
    expect(midnight >= businessDayRange('2026-11-15').start).toBe(true);
  });

  it('funciona con el cambio de ano y con el 29 de febrero', () => {
    expect(businessDayRange('2026-12-31').end.toISOString()).toBe('2027-01-01T05:00:00.000Z');
    expect(businessDayRange('2028-02-29').end.toISOString()).toBe('2028-03-01T05:00:00.000Z');
  });
});

describe('businessDateOf', () => {
  it.each([
    ['2026-11-14T05:00:00Z', '2026-11-14'], // medianoche en Colombia: ya es el dia 14
    ['2026-11-14T04:59:59Z', '2026-11-13'], // un segundo antes: todavia el 13
    ['2026-11-15T01:00:00Z', '2026-11-14'], // 20:00 en Neiva = 01:00 UTC del dia siguiente
    ['2026-11-15T04:59:59Z', '2026-11-14'],
    ['2026-11-15T05:00:00Z', '2026-11-15'],
  ])('%s es del dia de negocio %s', (iso, expected) => {
    expect(businessDateOf(new Date(iso))).toBe(expected);
  });

  it('es la inversa de businessDayRange: inicio y ultimo instante del dia dan ese dia', () => {
    const { start, end } = businessDayRange('2026-12-31');
    expect(businessDateOf(start)).toBe('2026-12-31');
    expect(businessDateOf(new Date(end.getTime() - 1))).toBe('2026-12-31');
    expect(businessDateOf(end)).toBe('2027-01-01');
  });
});
