import { describe, expect, it } from 'vitest'
import { formatLongDate, isValidDay, nameOf, todayLocal } from './cashClose.js'

describe('todayLocal', () => {
  it('usa el dia LOCAL, no el UTC: a las 11:30 p. m. sigue siendo el mismo dia', () => {
    // Fecha construida en hora local: en Colombia ya seria el dia siguiente en UTC
    expect(todayLocal(new Date(2026, 10, 14, 23, 30))).toBe('2026-11-14')
  })

  it('rellena con ceros el mes y el dia', () => {
    expect(todayLocal(new Date(2026, 0, 5, 8, 0))).toBe('2026-01-05')
  })

  it('cambio de ano', () => {
    expect(todayLocal(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31')
    expect(todayLocal(new Date(2027, 0, 1, 0, 0))).toBe('2027-01-01')
  })
})

describe('isValidDay', () => {
  it.each(['2026-11-14', '2028-02-29', '2026-01-01'])('%s es un dia real', (value) => {
    expect(isValidDay(value)).toBe(true)
  })

  it.each(['', 'ayer', '2026-1-5', '14-11-2026', '2026-02-30', '2026-13-01', '2026-02-29', null, undefined, 20261114])(
    '%s no lo es',
    (value) => {
      expect(isValidDay(value)).toBe(false)
    },
  )
})

describe('formatLongDate', () => {
  it('escribe el dia completo en espanol', () => {
    expect(formatLongDate('2026-11-14')).toBe('14 de noviembre de 2026')
  })

  it('es una fecha de calendario: no se corre un dia por la zona horaria', () => {
    expect(formatLongDate('2026-01-01')).toBe('1 de enero de 2026')
    expect(formatLongDate('2026-12-31')).toBe('31 de diciembre de 2026')
  })
})

describe('nameOf', () => {
  const list = [{ id: 'a', name: 'Efectivo' }]

  it('devuelve el nombre del id', () => {
    expect(nameOf(list, 'id', 'name', 'a', 'x')).toBe('Efectivo')
  })

  it('devuelve el texto de respaldo si el id no aparece', () => {
    expect(nameOf(list, 'id', 'name', 'zzz', 'Desconocido')).toBe('Desconocido')
    expect(nameOf([], 'id', 'name', 'a', 'Desconocido')).toBe('Desconocido')
  })
})
