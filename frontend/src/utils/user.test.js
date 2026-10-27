import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/errors.js'
import { countByRole, displayName, initial, loginErrorMessage, roleLabel } from './user.js'

describe('displayName e initial', () => {
  it('deriva el nombre del email', () => {
    expect(displayName('maria.garcia@lapizzeta.com')).toBe('Maria Garcia')
    expect(displayName('juan_diaz@lapizzeta.com')).toBe('Juan Diaz')
    expect(displayName('ADMIN@lapizzeta.com')).toBe('Admin')
  })

  it('ignora los numeros (emails de prueba con marca de tiempo)', () => {
    expect(displayName('cocinero.1793114961083@lapizzeta.com')).toBe('Cocinero')
  })

  it('usa la inicial del nombre derivado', () => {
    expect(initial('william@lapizzeta.com')).toBe('W')
    expect(initial('')).toBe('?')
  })
})

describe('countByRole', () => {
  it('cuenta todos los usuarios por rol, activos o no', () => {
    const users = [
      { role: 'ADMIN', isActive: true },
      { role: 'WAITER', isActive: true },
      { role: 'WAITER', isActive: false },
      { role: 'COOK', isActive: true },
    ]
    expect(countByRole(users)).toEqual({ total: 4, ADMIN: 1, WAITER: 2, COOK: 1 })
  })
})

describe('roleLabel', () => {
  it('traduce el rol', () => {
    expect(roleLabel('WAITER')).toBe('Mesero')
    expect(roleLabel('XYZ')).toBe('XYZ')
  })
})

describe('loginErrorMessage', () => {
  it('no revela cual dato es incorrecto', () => {
    const err = new ApiError(401, 'UNAUTHENTICATED', 'x')
    expect(loginErrorMessage(err)).toBe('Correo o contraseña incorrectos')
  })

  it('informa el bloqueo con la hora de fin', () => {
    const err = new ApiError(423, 'ACCOUNT_LOCKED', 'x', { lockedUntil: '2026-10-27T15:30:00Z' })
    expect(loginErrorMessage(err)).toMatch(/bloqueada temporalmente/i)
  })

  it('distingue el limite de intentos y los errores de red', () => {
    expect(loginErrorMessage(new ApiError(429, 'RATE_LIMITED', 'x'))).toMatch(/Demasiados intentos/)
    expect(loginErrorMessage(new ApiError(0, 'NETWORK_ERROR', 'x'))).toMatch(/No se pudo conectar/)
  })
})
