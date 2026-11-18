import { describe, expect, it, vi } from 'vitest'
import {
  daysBetween,
  defaultHistoryFilters,
  filterOptions,
  formatReference,
  historyRangeError,
  methodName,
  sameFilters,
  saveFile,
  tableLabel,
  UNKNOWN_METHOD,
  UNKNOWN_WAITER,
  waiterName,
} from './salesHistory.js'

describe('defaultHistoryFilters', () => {
  it('hoy (hora LOCAL) en desde y hasta, y los demas filtros en "todos"', () => {
    // 11:30 p. m. del 14 en hora local: en UTC ya es el 15, pero el dia del restaurante sigue siendo el 14
    expect(defaultHistoryFilters(new Date(2026, 10, 14, 23, 30))).toEqual({
      from: '2026-11-14',
      to: '2026-11-14',
      waiterId: '',
      tableId: '',
      paymentMethodId: '',
    })
  })
})

describe('historyRangeError (misma regla que el backend)', () => {
  it.each([
    ['2026-11-14', '2026-11-14'],
    ['2026-01-01', '2027-01-01'], // 366 dias: el maximo
  ])('%s a %s es valido', (from, to) => {
    expect(historyRangeError({ from, to })).toBeNull()
  })

  it('desde posterior a hasta', () => {
    expect(historyRangeError({ from: '2026-11-15', to: '2026-11-14' })).toBe(
      'La fecha desde no puede ser posterior a la fecha hasta.',
    )
  })

  it('mas de 366 dias', () => {
    expect(historyRangeError({ from: '2026-01-01', to: '2027-01-02' })).toBe(
      'El rango no puede pasar de 366 días.',
    )
  })

  it.each([
    ['', '2026-11-14'],
    ['2026-11-14', ''],
    ['2026-02-30', '2026-03-01'],
  ])('fecha vacia o inexistente (%s, %s)', (from, to) => {
    expect(historyRangeError({ from, to })).toBe('Elige una fecha desde y una fecha hasta.')
  })
})

describe('daysBetween', () => {
  it.each([
    ['2026-11-14', '2026-11-14', 1],
    ['2026-11-01', '2026-11-14', 14],
    ['2028-01-01', '2028-12-31', 366],
  ])('%s a %s = %i', (from, to, days) => {
    expect(daysBetween(from, to)).toBe(days)
  })
})

describe('sameFilters', () => {
  const base = { from: 'a', to: 'b', waiterId: '', tableId: '', paymentMethodId: '' }
  it('iguales aunque un filtro venga undefined en vez de ""', () => {
    expect(sameFilters(base, { from: 'a', to: 'b' })).toBe(true)
  })
  it('distintos si cambia cualquier filtro', () => {
    expect(sameFilters(base, { ...base, tableId: 't' })).toBe(false)
    expect(sameFilters(base, { ...base, to: 'c' })).toBe(false)
  })
})

describe('formatReference', () => {
  it('antepone # a la referencia del backend', () => {
    expect(formatReference('3F9A1C')).toBe('#3F9A1C')
  })
  it('sin referencia la deriva del id (6 primeros caracteres en mayusculas)', () => {
    expect(formatReference(undefined, '3f9a1c7e-0b2d-4e5f-8a9b-1c2d3e4f5a6b')).toBe('#3F9A1C')
  })
  it('sin nada, vacio', () => {
    expect(formatReference()).toBe('')
  })
})

describe('nombres', () => {
  const employees = [{ userId: 'w-1', fullName: 'Laura Gómez' }]
  const methods = [{ paymentMethodId: 'm-1', name: 'Efectivo' }]

  it('mesero y metodo por su id; si no aparece, el nombre generico', () => {
    expect(waiterName(employees, 'w-1')).toBe('Laura Gómez')
    expect(waiterName(employees, 'w-9')).toBe(UNKNOWN_WAITER)
    expect(methodName(methods, 'm-1')).toBe('Efectivo')
    expect(methodName([], 'm-1')).toBe(UNKNOWN_METHOD)
  })

  it('mesa por su numero', () => {
    expect(tableLabel(7)).toBe('Mesa 7')
  })
})

describe('filterOptions', () => {
  it('mesas por numero; meseros y metodos por nombre (orden de diccionario en espanol)', () => {
    const out = filterOptions({
      tables: [
        { tableId: 't-10', tableNumber: 10 },
        { tableId: 't-2', tableNumber: 2 },
      ],
      employees: [
        { userId: 'w-2', fullName: 'Óscar Peña' },
        { userId: 'w-1', fullName: 'Ana Ruiz' },
      ],
      methods: [
        { paymentMethodId: 'm-2', name: 'Tarjeta' },
        { paymentMethodId: 'm-1', name: 'Efectivo' },
      ],
    })
    expect(out.tables).toEqual([
      { value: 't-2', label: 'Mesa 2' },
      { value: 't-10', label: 'Mesa 10' },
    ])
    expect(out.waiters.map((w) => w.label)).toEqual(['Ana Ruiz', 'Óscar Peña'])
    expect(out.methods.map((m) => m.label)).toEqual(['Efectivo', 'Tarjeta'])
  })

  it('sin listas (no cargaron) devuelve opciones vacias', () => {
    expect(filterOptions({})).toEqual({ tables: [], waiters: [], methods: [] })
  })
})

describe('saveFile', () => {
  it('crea un enlace con el nombre del archivo, lo pulsa y libera la URL', () => {
    const blob = new Blob(['PK'])
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    saveFile(blob, 'ventas_a_b.xlsx')

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob)
    expect(click).toHaveBeenCalledTimes(1)
    const link = click.mock.contexts[0]
    expect(link.download).toBe('ventas_a_b.xlsx')
    expect(link.href).toBe('blob:x')
    expect(document.querySelector('a[download]')).toBeNull() // no queda en la pagina
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x')
    click.mockRestore()
  })
})
