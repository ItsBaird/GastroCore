import { describe, expect, it } from 'vitest';
import { dashboardQuerySchema } from './dashboard.schema.js';

const issues = (query) => {
  const result = dashboardQuerySchema.safeParse(query);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('dashboardQuerySchema', () => {
  it('acepta sin parametros (semana en curso) y un rango valido', () => {
    expect(issues({})).toEqual([]);
    expect(issues({ from: '2026-11-10', to: '2026-11-10' })).toEqual([]);
  });

  it('92 dias con ambos extremos pasa; 93 es 400', () => {
    expect(issues({ from: '2026-01-01', to: '2026-04-02' })).toEqual([]);
    expect(issues({ from: '2026-01-01', to: '2026-04-03' })).toEqual([
      'to: El rango máximo es de 92 días',
    ]);
  });

  it('from posterior a to', () => {
    expect(issues({ from: '2026-11-12', to: '2026-11-10' })).toEqual([
      'to: La fecha final no puede ser anterior a la inicial',
    ]);
  });

  it('solo una de las dos fechas', () => {
    expect(issues({ from: '2026-11-10' })).toEqual([
      'to: Indica las dos fechas del periodo (desde y hasta) o ninguna',
    ]);
    expect(issues({ to: '2026-11-10' })).toEqual([
      'from: Indica las dos fechas del periodo (desde y hasta) o ninguna',
    ]);
  });

  it('fechas inexistentes o mal escritas: solo errores de esa fecha, el rango no se calcula', () => {
    expect(issues({ from: '2026-02-30', to: '2026-03-01' })).toEqual([
      'from: La fecha no existe en el calendario',
    ]);
    // "ayer" trae los dos mensajes de la regla de fecha del cierre de caja (formato y calendario), nada del rango
    const ayer = issues({ from: 'ayer', to: '2026-03-01' });
    expect(ayer.length).toBeGreaterThan(0);
    expect(ayer.every((i) => i.startsWith('from: '))).toBe(true);
  });

  it('parametros desconocidos o repetidos son 400', () => {
    expect(issues({ from: '2026-11-10', to: '2026-11-10', waiter: 'x' })).not.toEqual([]);
    expect(issues({ from: ['2026-11-10', '2026-11-11'], to: '2026-11-12' })).not.toEqual([]);
  });
});
