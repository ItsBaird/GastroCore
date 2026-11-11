import { describe, expect, it } from 'vitest';
import { deriveTableStatus } from './tableState.js';

describe('deriveTableStatus (el mismo estado para el panel y el QR)', () => {
  it.each([
    ['sin ordenes abiertas', [], 'libre'],
    ['sin lista', undefined, 'libre'],
    ['orden ABIERTA', [{ status: 'ABIERTA' }], 'ocupada'],
    ['orden EN_COBRO', [{ status: 'EN_COBRO' }], 'en_cobro'],
  ])('%s -> %s', (_label, orders, expected) => {
    expect(deriveTableStatus(orders)).toBe(expected);
  });
});
