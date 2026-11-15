import { describe, expect, it } from 'vitest';
import { assertDemoSeedAllowed, seedUuid } from './ids.js';

// Estos valores son iguales en los cuatro servicios: si una copia de ids.js se desvia, deja de coincidir y falla.
describe('seedUuid', () => {
  it('da siempre el mismo UUID para el mismo nombre (valores fijados, comunes a los cuatro servicios)', () => {
    expect(seedUuid('user:mesero1')).toBe('fa6a2e90-5716-5f70-b2df-8a8ccc6529ec');
    expect(seedUuid('user:mesero2')).toBe('9695e217-abd2-532f-9348-662810f26624');
    expect(seedUuid('user:mesero3')).toBe('4c2da9ab-f444-5db9-babb-bee9cb477a9c');
    expect(seedUuid('user:cocinero1')).toBe('b2406335-20f6-5999-ae2f-dd19b972a33e');
    expect(seedUuid('product:limonada-natural')).toBe('010f9724-a9b3-5c3b-886d-22ba18ab2f33');
    expect(seedUuid('product:pasta-carbonara')).toBe('e62945fa-a44b-5fac-b010-08005ecc393b');
  });

  it('nombres distintos dan ids distintos', () => {
    expect(seedUuid('a')).not.toBe(seedUuid('b'));
  });

  it('es un UUID valido (version 5, variante RFC 4122) que acepta la validacion de uuid de los servicios', () => {
    expect(seedUuid('cualquier cosa')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('assertDemoSeedAllowed', () => {
  it('en desarrollo o pruebas no se opone', () => {
    expect(() => assertDemoSeedAllowed({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertDemoSeedAllowed({})).not.toThrow();
  });

  it('en produccion se niega', () => {
    expect(() => assertDemoSeedAllowed({ NODE_ENV: 'production' })).toThrow(/production/);
  });

  it('en produccion solo corre con SEED_DEMO_FORCE=true exacto', () => {
    expect(() =>
      assertDemoSeedAllowed({ NODE_ENV: 'production', SEED_DEMO_FORCE: 'true' }),
    ).not.toThrow();
    expect(() => assertDemoSeedAllowed({ NODE_ENV: 'production', SEED_DEMO_FORCE: '1' })).toThrow();
  });
});
