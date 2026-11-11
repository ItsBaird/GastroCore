import { describe, expect, it } from 'vitest';
import { getQrCapabilities } from './qrCapabilities.js';

describe('getQrCapabilities (tabla de verdad del canal QR)', () => {
  it.each([
    ['libre', { viewMenu: true, callWaiter: true, sendRequest: false, requestBill: false }],
    ['ocupada', { viewMenu: true, callWaiter: true, sendRequest: true, requestBill: true }],
    ['en_cobro', { viewMenu: true, callWaiter: true, sendRequest: false, requestBill: false }],
  ])('%s', (status, expected) => {
    expect(getQrCapabilities(status)).toEqual(expected);
  });

  it.each([undefined, null, '', 'CERRADA', 'OCUPADA', 'toString', '__proto__'])(
    'estado desconocido (%s) cierra por defecto: solo ver el menu',
    (status) => {
      expect(getQrCapabilities(status)).toEqual({
        viewMenu: true,
        callWaiter: false,
        sendRequest: false,
        requestBill: false,
      });
    },
  );

  it('devuelve una copia: modificarla no cambia la tabla', () => {
    getQrCapabilities('libre').sendRequest = true;
    expect(getQrCapabilities('libre').sendRequest).toBe(false);
  });
});
