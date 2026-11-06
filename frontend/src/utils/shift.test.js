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
  pickCurrentShift,
  shiftActionMessage,
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

describe('pickCurrentShift', () => {
  const NOW = Date.parse('2026-11-09T15:00:00Z') // lunes 10:00 a. m. en Colombia
  const TODAY = '2026-11-09'
  const mk = (id, status, date, from, to) => ({
    shiftId: id,
    status,
    scheduledStart: new Date(toIso(date, from)).toISOString(),
    scheduledEnd: new Date(toIso(date, to)).toISOString(),
  })
  const pick = (shifts) => pickCurrentShift(shifts, NOW, TODAY)

  it('sin turnos -> ninguno', () => {
    expect(pick([])).toEqual({ kind: 'ninguno', shift: null })
  })

  it('un turno activo manda sobre cualquier otro', () => {
    const active = mk('a', 'activo', '2026-11-09', '08:00', '16:00')
    const scheduled = mk('p', 'programado', '2026-11-09', '17:00', '22:00')
    expect(pick([scheduled, active]).kind).toBe('activo')
    expect(pick([scheduled, active]).shift.shiftId).toBe('a')
  })

  it('un turno activo de otro dia (se quedo abierto) tambien se muestra', () => {
    expect(pick([mk('a', 'activo', '2026-11-08', '21:00', '23:00')]).kind).toBe('activo')
  })

  it('programado de hoy; entre varios prefiere el que aun no termino', () => {
    const past = mk('past', 'programado', '2026-11-09', '06:00', '09:00')
    const later = mk('later', 'programado', '2026-11-09', '17:00', '22:00')
    expect(pick([past, later]).shift.shiftId).toBe('later')
  })

  it('si todos los programados de hoy ya terminaron, muestra el ultimo (el servidor explicara que ya paso)', () => {
    const a = mk('a', 'programado', '2026-11-09', '05:00', '07:00')
    const b = mk('b', 'programado', '2026-11-09', '07:30', '09:00')
    expect(pick([a, b])).toMatchObject({ kind: 'programado', shift: { shiftId: 'b' } })
  })

  it('finalizado de hoy cuando no queda nada pendiente', () => {
    expect(pick([mk('f', 'finalizado', '2026-11-09', '06:00', '09:00')]).kind).toBe('finalizado')
  })

  it('proximo turno de otro dia', () => {
    const later = mk('n2', 'programado', '2026-11-12', '08:00', '16:00')
    const sooner = mk('n1', 'programado', '2026-11-10', '08:00', '16:00')
    expect(pick([later, sooner])).toMatchObject({ kind: 'proximo', shift: { shiftId: 'n1' } })
  })

  it('un turno programado de un dia pasado no cuenta como proximo', () => {
    expect(pick([mk('old', 'programado', '2026-11-03', '08:00', '16:00')]).kind).toBe('ninguno')
  })

  it('el dia se cuenta en hora de Colombia: domingo 9 p. m. no es "hoy" lunes', () => {
    const sundayNight = mk('s', 'finalizado', '2026-11-08', '21:00', '23:00')
    expect(pick([sundayNight]).kind).toBe('ninguno')
  })
})

describe('shiftActionMessage', () => {
  const err = (status, code, details) => new ApiError(status, code, 'x', details)

  it('antes de la hora: dice cuando empieza el turno', () => {
    const msg = shiftActionMessage(
      err(409, 'INVALID_TRANSITION', {
        reason: 'BEFORE_START',
        scheduledStart: '2026-11-09T13:00:00.000Z',
        scheduledEnd: '2026-11-09T21:00:00.000Z',
      }),
    )
    expect(msg.message).toBe('Todavía no es la hora de tu turno. Empieza hoy a las 8:00 a. m.')
    expect(msg.refresh).toBeUndefined()
  })

  it('despues de la hora: dice a que hora termino', () => {
    const msg = shiftActionMessage(
      err(409, 'INVALID_TRANSITION', {
        reason: 'AFTER_END',
        scheduledStart: '2026-11-09T13:00:00.000Z',
        scheduledEnd: '2026-11-09T21:00:00.000Z',
      }),
    )
    expect(msg.message).toMatch(/ya terminó \(a las 4:00 p\. m\.\)/)
  })

  it('otro cambio de estado -> pide actualizar', () => {
    const msg = shiftActionMessage(err(409, 'INVALID_TRANSITION', { status: 'activo' }))
    expect(msg.refresh).toBe(true)
  })

  it('mesas abiertas: singular, plural y version para el admin', () => {
    expect(shiftActionMessage(err(409, 'HAS_OPEN_TABLES', { count: 1 })).message).toMatch(
      /Tienes 1 mesa abierta\. El administrador debe reasignarlas/,
    )
    expect(shiftActionMessage(err(409, 'HAS_OPEN_TABLES', { count: 3 })).message).toMatch(
      /Tienes 3 mesas abiertas/,
    )
    expect(shiftActionMessage(err(409, 'HAS_OPEN_TABLES', { count: 2 }), { own: false }).message).toBe(
      'El empleado tiene 2 mesas abiertas. Reasígnalas antes de finalizar su turno.',
    )
  })

  it('Orders caido, turno inexistente, sin permiso, sin red y desconocido', () => {
    expect(shiftActionMessage(err(503, 'DEPENDENCY_UNAVAILABLE')).message).toMatch(
      /verificar las mesas abiertas/,
    )
    expect(shiftActionMessage(err(404, 'NOT_FOUND'))).toMatchObject({ refresh: true })
    expect(
      shiftActionMessage(new ApiError(403, 'FORBIDDEN', 'Solo puedes iniciar tu propio turno')).message,
    ).toBe('Solo puedes iniciar tu propio turno')
    expect(shiftActionMessage(err(0, 'NETWORK_ERROR')).message).toMatch(/conectar/)
    expect(shiftActionMessage(err(500, 'INTERNAL_ERROR')).message).toMatch(/Inténtalo/)
    expect(shiftActionMessage(new Error('x')).message).toBeDefined()
  })
})
