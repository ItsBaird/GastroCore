import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/errors.js'
import {
  addDays,
  dayKey,
  formatDayHeading,
  formatDuration,
  formatTime,
  formatWeekRange,
  mapShiftError,
  mondayOf,
  toIso,
  validateShift,
  weekDays,
} from './shift.js'

describe('semanas (lunes a domingo)', () => {
  // 2026-11-02 es lunes y 2026-11-08 es domingo
  it.each(['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-08'])(
    'el lunes de %s es 2026-11-02',
    (date) => {
      expect(mondayOf(date)).toBe('2026-11-02')
    },
  )

  it('el lunes siguiente abre otra semana', () => {
    expect(mondayOf('2026-11-09')).toBe('2026-11-09')
  })

  it('addDays cruza mes, año y año bisiesto', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-11-09', -7)).toBe('2026-11-02')
  })

  it('weekDays devuelve los 7 días desde el lunes', () => {
    expect(weekDays('2026-11-02')).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
    ])
  })
})

describe('formatos', () => {
  it('encabezado del día', () => {
    expect(formatDayHeading('2026-11-09')).toBe('Lunes 9 de noviembre')
    expect(formatDayHeading('2026-11-08')).toBe('Domingo 8 de noviembre')
  })

  it('rango de la semana, incluso cruzando de año', () => {
    expect(formatWeekRange('2026-11-02')).toBe('2 nov – 8 nov 2026')
    expect(formatWeekRange('2026-12-28')).toBe('28 dic – 3 ene 2027')
  })

  it('las horas se muestran en hora de Colombia (UTC-5)', () => {
    expect(formatTime('2026-11-09T13:00:00Z')).toBe('8:00 a. m.')
    expect(formatTime('2026-11-09T21:30:00Z')).toBe('4:30 p. m.')
    expect(formatTime('2026-11-09T05:00:00Z')).toBe('12:00 a. m.')
  })

  it('el día de un instante también es el de Colombia: domingo 9 p. m. no pasa al lunes', () => {
    expect(dayKey('2026-11-09T02:00:00Z')).toBe('2026-11-08')
    expect(dayKey('2026-11-09T05:00:00Z')).toBe('2026-11-09')
  })

  it('duración', () => {
    expect(formatDuration('2026-11-09T13:00:00Z', '2026-11-09T21:00:00Z')).toBe('8h 00m')
    expect(formatDuration('2026-11-09T13:00:00Z', '2026-11-09T16:30:00Z')).toBe('3h 30m')
    expect(formatDuration('2026-11-09T13:00:00Z', '2026-11-09T13:45:00Z')).toBe('0h 45m')
  })

  it('toIso arma la fecha con la zona de Colombia', () => {
    expect(toIso('2026-11-09', '08:00')).toBe('2026-11-09T08:00:00-05:00')
    expect(new Date(toIso('2026-11-09', '08:00')).toISOString()).toBe('2026-11-09T13:00:00.000Z')
  })
})

describe('validateShift', () => {
  const OK = { userId: 'u1', date: '2026-11-09', start: '08:00', end: '16:00' }

  it('datos correctos -> sin errores', () => {
    expect(validateShift(OK)).toEqual({})
  })

  it('todo es obligatorio', () => {
    const errors = validateShift({ userId: '', date: '', start: '', end: '' })
    expect(Object.keys(errors).sort()).toEqual(['date', 'end', 'start', 'userId'])
  })

  it.each([
    ['fin anterior al inicio', '16:00', '08:00'],
    ['fin igual al inicio', '08:00', '08:00'],
  ])('rango inválido: %s', (_name, start, end) => {
    expect(validateShift({ ...OK, start, end }).end).toMatch(/rango horario no es válido/)
  })

  it('un minuto de diferencia ya es un rango válido', () => {
    expect(validateShift({ ...OK, start: '08:00', end: '08:01' })).toEqual({})
  })

  it('rechaza fechas que no existen', () => {
    expect(validateShift({ ...OK, date: '2026-02-31' }).date).toBe('La fecha no es válida')
  })
})

describe('mapShiftError', () => {
  it('el error de rango del servidor se muestra en la hora de fin', () => {
    const err = new ApiError(400, 'VALIDATION_ERROR', 'x', {
      fields: [{ path: 'scheduledEnd', message: 'El rango horario no es valido' }],
    })
    expect(mapShiftError(err).fields).toEqual({ end: 'El rango horario no es valido' })
  })

  it('empleado inexistente -> mensaje en el campo empleado', () => {
    expect(mapShiftError(new ApiError(404, 'NOT_FOUND', 'x')).fields.userId).toMatch(/ya no existe/)
  })

  it('sin red, sin permiso y errores desconocidos -> mensaje general', () => {
    expect(mapShiftError(new ApiError(0, 'NETWORK_ERROR', 'x')).general).toMatch(/conectar/)
    expect(mapShiftError(new ApiError(403, 'FORBIDDEN', 'sin permiso')).general).toBe('sin permiso')
    expect(mapShiftError(new ApiError(500, 'INTERNAL_ERROR', 'x')).general).toMatch(/Inténtalo/)
    expect(mapShiftError(new Error('x')).general).toBeDefined()
  })
})
