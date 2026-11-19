import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/errors.js'
import { mapPaymentMethodError, validatePaymentMethod } from './paymentMethod.js'

describe('validatePaymentMethod', () => {
  it('un nombre normal es valido, incluso de 50 caracteres', () => {
    expect(validatePaymentMethod({ name: 'Nequi' })).toEqual({})
    expect(validatePaymentMethod({ name: 'x'.repeat(50) })).toEqual({})
  })

  it.each(['', '   '])('rechaza el nombre vacio %j', (name) => {
    expect(validatePaymentMethod({ name }).name).toBe('El nombre es obligatorio')
  })

  it('rechaza mas de 50 caracteres (despues de recortar espacios)', () => {
    expect(validatePaymentMethod({ name: 'x'.repeat(51) }).name).toBe('Admite hasta 50 caracteres')
    expect(validatePaymentMethod({ name: `  ${'x'.repeat(50)}  ` })).toEqual({})
  })
})

describe('mapPaymentMethodError', () => {
  it('nombre duplicado -> mensaje en el campo nombre', () => {
    const out = mapPaymentMethodError(new ApiError(409, 'CONFLICT', 'x', { field: 'name' }))
    expect(out.fields).toEqual({ name: 'Ya existe un método de pago con ese nombre' })
  })

  it('errores de validacion del servidor van a su campo', () => {
    const err = new ApiError(400, 'VALIDATION_ERROR', 'x', {
      fields: [{ path: 'name', message: 'invalido' }],
    })
    expect(mapPaymentMethodError(err).fields).toEqual({ name: 'invalido' })
  })

  it('metodo inexistente, sin permiso, sin red y errores desconocidos -> mensaje general', () => {
    expect(mapPaymentMethodError(new ApiError(404, 'NOT_FOUND', 'x')).general).toMatch(/ya no existe/)
    expect(mapPaymentMethodError(new ApiError(403, 'FORBIDDEN', 'sin permiso')).general).toBe('sin permiso')
    expect(mapPaymentMethodError(new ApiError(0, 'NETWORK_ERROR', 'x')).general).toMatch(/conectar/)
    expect(mapPaymentMethodError(new ApiError(500, 'INTERNAL_ERROR', 'x')).general).toMatch(/Inténtalo/)
    expect(mapPaymentMethodError(new Error('x')).general).toBeDefined()
  })
})
