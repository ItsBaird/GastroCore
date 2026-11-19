import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/errors.js'
import { formatHireDate, mapEmployeeError, validateEmployee } from './employee.js'

const OK = {
  userId: 'u1',
  fullName: 'Carlos',
  documentNumber: '123',
  position: 'Mesero',
  phone: '',
  hireDate: '2026-03-15',
}

describe('validateEmployee', () => {
  it('datos correctos -> sin errores', () => {
    expect(validateEmployee(OK, { needsUser: true })).toEqual({})
  })

  it('el usuario solo se exige al crear', () => {
    const values = { ...OK, userId: '' }
    expect(validateEmployee(values, { needsUser: true }).userId).toBe('Selecciona un usuario')
    expect(validateEmployee(values, { needsUser: false }).userId).toBeUndefined()
  })

  it('respeta los límites de las columnas', () => {
    const errors = validateEmployee(
      {
        ...OK,
        fullName: 'x'.repeat(151),
        documentNumber: '9'.repeat(31),
        position: 'x'.repeat(51),
        phone: '3'.repeat(31),
      },
      { needsUser: false },
    )
    expect(Object.keys(errors).sort()).toEqual(['documentNumber', 'fullName', 'phone', 'position'])
  })

  it('el teléfono es opcional', () => {
    expect(validateEmployee({ ...OK, phone: '   ' }, { needsUser: false }).phone).toBeUndefined()
  })

  it.each(['15/03/2026', '2026-02-31', '2026-13-01', 'hoy'])('rechaza la fecha %s', (hireDate) => {
    expect(validateEmployee({ ...OK, hireDate }, { needsUser: false }).hireDate).toMatch(/fecha/i)
  })

  it('acepta 29 de febrero solo en año bisiesto', () => {
    expect(validateEmployee({ ...OK, hireDate: '2028-02-29' }, { needsUser: false })).toEqual({})
    expect(validateEmployee({ ...OK, hireDate: '2027-02-29' }, { needsUser: false }).hireDate).toBeDefined()
  })
})

describe('formatHireDate', () => {
  it('formatea la fecha de calendario sin correrla de día', () => {
    expect(formatHireDate('2026-03-15')).toBe('15 mar 2026')
    expect(formatHireDate('2026-01-01')).toBe('1 ene 2026')
    expect(formatHireDate('2026-12-31')).toBe('31 dic 2026')
  })

  it('un valor que no es fecha se devuelve tal cual', () => {
    expect(formatHireDate('x')).toBe('x')
    expect(formatHireDate(undefined)).toBe('')
  })
})

describe('mapEmployeeError', () => {
  it('documento duplicado y usuario con perfil -> mensaje en su campo', () => {
    expect(mapEmployeeError(new ApiError(409, 'CONFLICT', 'x', { field: 'documentNumber' })).fields).toEqual({
      documentNumber: 'Este número de documento ya está registrado',
    })
    expect(mapEmployeeError(new ApiError(409, 'CONFLICT', 'x', { field: 'userId' })).fields).toEqual({
      userId: 'Este usuario ya tiene un perfil de empleado',
    })
  })

  it('errores de validación del servidor van a su campo', () => {
    const err = new ApiError(400, 'VALIDATION_ERROR', 'x', {
      fields: [{ path: 'userId', message: 'El usuario no existe en Auth' }],
    })
    expect(mapEmployeeError(err).fields).toEqual({ userId: 'El usuario no existe en Auth' })
  })

  it('Auth caído, sin red, 404 y errores desconocidos -> mensaje general', () => {
    expect(mapEmployeeError(new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'x')).general).toMatch(/Auth/)
    expect(mapEmployeeError(new ApiError(0, 'NETWORK_ERROR', 'x')).general).toMatch(/conectar/)
    expect(mapEmployeeError(new ApiError(404, 'NOT_FOUND', 'x')).general).toMatch(/ya no existe/)
    expect(mapEmployeeError(new ApiError(500, 'INTERNAL_ERROR', 'x')).general).toMatch(/Inténtalo/)
    expect(mapEmployeeError(new Error('x')).general).toBeDefined()
  })
})
