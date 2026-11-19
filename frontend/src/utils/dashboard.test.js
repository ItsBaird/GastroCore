import { describe, expect, it } from 'vitest'
import {
  barPercent,
  businessToday,
  deltaTone,
  formatCompactCOP,
  formatHourSlot,
  formatMinutes,
  formatPercent,
  formatRange,
  formatShare,
  formatShortDate,
  labelStep,
  niceScale,
  PRESETS,
  remainingDays,
  validateRange,
  weekOf,
} from './dashboard.js'

describe('fechas de negocio en America/Bogota', () => {
  it('hoy es el de Colombia aunque en UTC ya sea el dia siguiente', () => {
    // domingo 15 a las 23:30 en Neiva = lunes 16 04:30 UTC
    expect(businessToday(new Date('2026-11-16T04:30:00Z'))).toBe('2026-11-15')
    expect(businessToday(new Date('2026-11-16T05:10:00Z'))).toBe('2026-11-16')
  })

  it('semana de lunes a domingo y accesos rapidos', () => {
    expect(weekOf('2026-11-22')).toEqual({ from: '2026-11-16', to: '2026-11-22' })
    const ranges = Object.fromEntries(PRESETS.map((p) => [p.id, p.range('2026-11-18')]))
    expect(ranges).toEqual({
      week: { from: '2026-11-16', to: '2026-11-22' },
      lastWeek: { from: '2026-11-09', to: '2026-11-15' },
      last30: { from: '2026-10-20', to: '2026-11-18' },
      month: { from: '2026-11-01', to: '2026-11-30' },
    })
    expect(PRESETS[3].range('2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })

  it('dias que faltan del periodo', () => {
    expect(remainingDays({ from: '2026-11-16', to: '2026-11-22' }, '2026-11-16')).toBe(6)
    expect(remainingDays({ from: '2026-11-16', to: '2026-11-22' }, '2026-11-22')).toBe(0)
    expect(remainingDays({ from: '2026-11-09', to: '2026-11-15' }, '2026-11-16')).toBe(0)
  })
})

describe('validateRange (las mismas reglas que el servidor)', () => {
  it.each([
    ['2026-11-10', '2026-11-10', ''],
    ['2026-01-01', '2026-04-02', ''],
    ['2026-01-01', '2026-04-03', 'El rango máximo es de 92 días.'],
    ['2026-11-12', '2026-11-10', 'La fecha final no puede ser anterior a la inicial.'],
    ['', '2026-11-10', 'Elige la fecha de inicio y la de fin.'],
    ['2026-02-30', '2026-03-01', 'Alguna de las fechas no es válida.'],
  ])('%s .. %s', (from, to, message) => {
    expect(validateRange(from, to)).toBe(message)
  })
})

describe('formatos es-CO', () => {
  it('fechas cortas y rangos', () => {
    expect(formatShortDate('2026-11-10')).toBe('10 nov')
    expect(formatRange({ from: '2026-11-16', to: '2026-11-22' })).toBe('16–22 nov 2026')
    expect(formatRange({ from: '2026-10-28', to: '2026-11-03' })).toBe('28 oct – 3 nov 2026')
    expect(formatRange({ from: '2026-12-28', to: '2027-01-03' })).toBe('28 dic 2026 – 3 ene 2027')
    expect(formatRange({ from: '2026-11-10', to: '2026-11-10' })).toBe('10 nov 2026')
  })

  it('porcentajes con signo y coma decimal; minutos; participacion', () => {
    expect(formatPercent(8.2)).toBe('+8,2 %')
    expect(formatPercent(-3.1)).toBe('−3,1 %')
    expect(formatPercent(0)).toBe('0,0 %')
    expect(formatMinutes(12.4)).toBe('12,4 min')
    expect(formatShare(1, 3)).toBe('33,3 %')
    expect(formatShare(5, 0)).toBe('0,0 %')
  })

  it('franja horaria de la hora pico', () => {
    expect(formatHourSlot(13)).toBe('1:00–2:00 p. m.')
    expect(formatHourSlot(11)).toBe('11:00 a. m.–12:00 p. m.')
    expect(formatHourSlot(0)).toBe('12:00–1:00 a. m.')
  })

  it('montos compactos para los ejes', () => {
    expect(formatCompactCOP(1250000)).toBe('$1,3 M')
    expect(formatCompactCOP(85000)).toBe('$85 mil')
    expect(formatCompactCOP(0)).toBe('$0')
  })
})

describe('lectura de los KPI', () => {
  it('el color dice bueno o malo, no sube o baja', () => {
    expect(deltaTone(8.2)).toBe('good')
    expect(deltaTone(-3.1)).toBe('bad')
    // preparacion: bajar es bueno
    expect(deltaTone(-4, { lowerIsBetter: true })).toBe('good')
    expect(deltaTone(4, { lowerIsBetter: true })).toBe('bad')
    expect(deltaTone(null)).toBe('neutral')
    expect(deltaTone(0)).toBe('neutral')
  })
})

describe('escalas', () => {
  it('desde 0, con marcas redondas y la ultima por encima del maximo', () => {
    expect(niceScale(62000)).toEqual({ max: 80000, ticks: [0, 20000, 40000, 60000, 80000] })
    expect(niceScale(7)).toEqual({ max: 8, ticks: [0, 2, 4, 6, 8] })
    // periodo sin ventas: escala valida, sin division por cero
    expect(niceScale(0)).toEqual({ max: 1, ticks: [0] })
  })

  it('barras nunca negativas, ni NaN, ni por encima del 100 %', () => {
    expect(barPercent(50, 200)).toBe(25)
    expect(barPercent(0, 0)).toBe(0)
    expect(barPercent(-5, 100)).toBe(0)
    expect(barPercent(300, 200)).toBe(100)
  })

  it('etiquetas del eje: hasta 8, en un paso que llega al ultimo', () => {
    expect(labelStep(7)).toBe(1)
    expect(labelStep(24)).toBe(4)
    expect(labelStep(92)).toBe(13)
  })
})
