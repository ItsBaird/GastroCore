import { describe, expect, it } from 'vitest'
import {
  addRound,
  applyItemChange,
  buildColumns,
  cardElapsedMs,
  countByStatus,
  formatClock,
  formatElapsed,
  isItemDelayed,
} from './kitchen.js'

const T0 = Date.parse('2026-11-07T15:00:00.000Z')
const iso = (ms) => new Date(ms).toISOString()

const item = (itemId, status, extra = {}) => ({
  itemId,
  roundId: 'r1',
  status,
  createdAt: iso(T0),
  updatedAt: iso(T0),
  readyAt: null,
  ...extra,
})
const round = (roundId, items, createdAt = T0) => ({
  roundId,
  tableNumber: 5,
  createdAt: iso(createdAt),
  items,
})

describe('buildColumns', () => {
  it('parte una ronda en una tarjeta por estado', () => {
    const columns = buildColumns([
      round('r1', [item('a', 'pendiente'), item('b', 'listo'), item('c', 'pendiente')]),
    ])

    expect(columns.pendiente).toHaveLength(1)
    expect(columns.pendiente[0].items.map((i) => i.itemId)).toEqual(['a', 'c'])
    expect(columns.en_preparacion).toEqual([])
    expect(columns.listo[0].key).toBe('r1:listo')
  })

  it('conserva el orden de llegada dentro de cada columna', () => {
    const columns = buildColumns([
      round('vieja', [item('a', 'pendiente')]),
      round('nueva', [item('b', 'pendiente')]),
    ])

    expect(columns.pendiente.map((c) => c.roundId)).toEqual(['vieja', 'nueva'])
  })
})

it('countByStatus cuenta items, no tarjetas', () => {
  expect(
    countByStatus([round('r1', [item('a', 'pendiente'), item('b', 'pendiente'), item('c', 'listo')])]),
  ).toEqual({ pendiente: 2, en_preparacion: 0, listo: 1 })
})

describe('tiempos', () => {
  it('una tarjeta activa cuenta desde la llegada de la ronda', () => {
    const card = { status: 'pendiente', createdAt: iso(T0), items: [] }
    expect(cardElapsedMs(card, T0 + 90_000)).toBe(90_000)
  })

  it('una tarjeta lista se congela en el ultimo readyAt', () => {
    const card = {
      status: 'listo',
      createdAt: iso(T0),
      items: [{ readyAt: iso(T0 + 60_000) }, { readyAt: iso(T0 + 120_000) }],
    }
    expect(cardElapsedMs(card, T0 + 999_000)).toBe(120_000)
  })

  it('un reloj atrasado respecto a la ronda no da tiempo negativo', () => {
    const card = { status: 'pendiente', createdAt: iso(T0), items: [] }
    expect(cardElapsedMs(card, T0 - 5000)).toBe(0)
  })

  it.each([
    [0, '0:00'],
    [65_000, '1:05'],
    [754_000, '12:34'],
    [3_600_000, '60:00'],
  ])('formatElapsed(%i) es %s', (ms, text) => {
    expect(formatElapsed(ms)).toBe(text)
  })

  it('el reloj se muestra en hora de Colombia', () => {
    expect(formatClock(T0)).toMatch(/^10:00/)
  })
})

describe('isItemDelayed', () => {
  const FIFTEEN = 15 * 60 * 1000

  it('no alerta un segundo antes de los 15 minutos', () => {
    expect(isItemDelayed(item('a', 'pendiente'), T0 + FIFTEEN - 1000)).toBe(false)
  })

  it.each(['pendiente', 'en_preparacion'])('alerta %s a los 15 minutos exactos', (status) => {
    expect(isItemDelayed(item('a', status), T0 + FIFTEEN)).toBe(true)
  })

  it('no alerta un item listo', () => {
    expect(isItemDelayed(item('a', 'listo'), T0 + FIFTEEN * 4)).toBe(false)
  })
})

describe('addRound', () => {
  it('ubica la ronda por hora de llegada', () => {
    const result = addRound([round('r2', [], T0 + 1000)], round('r1', [], T0))
    expect(result.map((r) => r.roundId)).toEqual(['r1', 'r2'])
  })

  it('no duplica una ronda ya conocida', () => {
    const rounds = [round('r1', [])]
    expect(addRound(rounds, round('r1', []))).toBe(rounds)
  })
})

describe('applyItemChange', () => {
  const later = iso(T0 + 1000)

  it('actualiza el item', () => {
    const [result] = applyItemChange(
      [round('r1', [item('a', 'pendiente')])],
      item('a', 'en_preparacion', { updatedAt: later }),
    )
    expect(result.items[0].status).toBe('en_preparacion')
  })

  it('un cambio viejo no pisa uno nuevo', () => {
    const [result] = applyItemChange(
      [round('r1', [item('a', 'listo', { updatedAt: later })])],
      item('a', 'en_preparacion', { updatedAt: iso(T0) }),
    )
    expect(result.items[0].status).toBe('listo')
  })

  it.each(['entregado', 'cancelado'])('%s saca el item de cocina', (status) => {
    const [result] = applyItemChange(
      [round('r1', [item('a', 'listo'), item('b', 'pendiente')])],
      item('a', status, { updatedAt: later }),
    )
    expect(result.items.map((i) => i.itemId)).toEqual(['b'])
  })

  it('una ronda sin items desaparece', () => {
    const result = applyItemChange(
      [round('r1', [item('a', 'pendiente')])],
      item('a', 'cancelado', { updatedAt: later }),
    )
    expect(result).toEqual([])
  })

  it('un item de otra ronda no cambia nada', () => {
    const rounds = [round('r2', [item('x', 'pendiente', { roundId: 'r2' })])]
    expect(applyItemChange(rounds, item('a', 'listo', { updatedAt: later }))).toEqual(rounds)
  })
})
