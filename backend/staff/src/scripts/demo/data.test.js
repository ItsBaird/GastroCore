import { describe, expect, it } from 'vitest';
import { DEMO_EMPLOYEES, addDays, bogotaTime, buildShifts, todayBogota } from './data.js';
import { seedUuid } from './ids.js';

// 14-nov-2026, 11:00 a. m. en Colombia (16:00 UTC)
const NOW = new Date('2026-11-14T16:00:00Z');
const shifts = buildShifts({ now: NOW });
const of = (key) => shifts.filter((s) => s.key === key);

describe('empleados de demostracion', () => {
  it('su userId es el de Auth: seedUuid(user:clave)', () => {
    expect(seedUuid('user:mesero1')).toBe('fa6a2e90-5716-5f70-b2df-8a8ccc6529ec');
    expect(DEMO_EMPLOYEES.map((e) => e.key)).toEqual([
      'mesero1',
      'mesero2',
      'mesero3',
      'cocinero1',
    ]);
  });

  it('cada documento es unico (la base lo exige) y los campos caben en las columnas', () => {
    const docs = DEMO_EMPLOYEES.map((e) => e.documentNumber);
    expect(new Set(docs).size).toBe(docs.length);
    for (const e of DEMO_EMPLOYEES) {
      expect(e.fullName.length).toBeLessThanOrEqual(150);
      expect(e.documentNumber.length).toBeLessThanOrEqual(30);
      expect(e.position.length).toBeLessThanOrEqual(50);
      expect(e.phone.length).toBeLessThanOrEqual(30);
      expect(e.hireDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('dia del restaurante', () => {
  it('es UTC-5: a la 1 a. m. UTC todavia es el dia anterior en Colombia', () => {
    expect(todayBogota(new Date('2026-11-15T01:00:00Z'))).toBe('2026-11-14');
    expect(todayBogota(new Date('2026-11-15T05:00:00Z'))).toBe('2026-11-15');
  });

  it('addDays cruza mes y ano', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('buildShifts', () => {
  it('es determinista: repetirlo da exactamente lo mismo (ids estables)', () => {
    expect(buildShifts({ now: NOW })).toEqual(buildShifts({ now: new Date(NOW) }));
  });

  it('cada empleado tiene 7 turnos finalizados en los 7 dias anteriores', () => {
    for (const e of DEMO_EMPLOYEES) {
      const past = of(e.key).filter((s) => s.status === 'finalizado');
      expect(past.map((s) => s.date)).toEqual([
        '2026-11-07',
        '2026-11-08',
        '2026-11-09',
        '2026-11-10',
        '2026-11-11',
        '2026-11-12',
        '2026-11-13',
      ]);
    }
  });

  it('los turnos pasados tienen inicio y fin reales, de 10:00 a 22:00 hora de Colombia', () => {
    const s = of('mesero1')[0];
    expect(s.scheduledStart.toISOString()).toBe('2026-11-07T15:00:00.000Z');
    expect(s.scheduledEnd.toISOString()).toBe('2026-11-08T03:00:00.000Z');
    expect(s.actualStart > s.scheduledStart).toBe(true);
    expect(s.actualEnd > s.actualStart).toBe(true);
  });

  it('hoy: mesero1 y cocinero1 activos, mesero2 programado, mesero3 sin turno', () => {
    const today = (key) => of(key).find((s) => s.date === '2026-11-14');
    expect(today('mesero1').status).toBe('activo');
    expect(today('cocinero1').status).toBe('activo');
    expect(today('mesero2').status).toBe('programado');
    expect(today('mesero3')).toBeUndefined();
  });

  it('manana: solo mesero3, programado', () => {
    const tomorrow = shifts.filter((s) => s.date === '2026-11-15');
    expect(tomorrow.map((s) => [s.key, s.status])).toEqual([['mesero3', 'programado']]);
  });

  it('un turno activo ya empezo (nunca en el futuro), incluso si el seed corre de madrugada', () => {
    const early = new Date('2026-11-14T08:00:00Z'); // 3:00 a. m. en Colombia, antes de las 06:00
    const active = buildShifts({ now: early }).find(
      (s) => s.key === 'mesero1' && s.status === 'activo',
    );
    expect(active.actualStart.getTime()).toBeLessThanOrEqual(early.getTime());
  });

  it('cumple las restricciones de la base: fin > inicio y timestamps coherentes con el estado', () => {
    for (const s of shifts) {
      expect(s.scheduledEnd > s.scheduledStart).toBe(true);
      if (s.status === 'programado') {
        expect(s.actualStart).toBeNull();
        expect(s.actualEnd).toBeNull();
      }
      if (s.status === 'activo') {
        expect(s.actualStart).not.toBeNull();
        expect(s.actualEnd).toBeNull();
      }
      if (s.status === 'finalizado') {
        expect(s.actualStart).not.toBeNull();
        expect(s.actualEnd).not.toBeNull();
        expect(s.actualEnd > s.actualStart).toBe(true);
      }
    }
  });

  it('los ids de turno son unicos', () => {
    const ids = shifts.map((s) => s.shiftId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('un turno por empleado y dia a las 06:00 de hoy usa la hora de Colombia', () => {
    expect(bogotaTime('2026-11-14', '06:00').toISOString()).toBe('2026-11-14T11:00:00.000Z');
  });
});
