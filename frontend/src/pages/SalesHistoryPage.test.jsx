// GC-RPT-0003 (GC-193). Pagina Ventas: filtros, resumen, tabla, paginacion y estados de carga/vacio/error.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/errors.js'
import { listSalesHistory } from '../api/history.js'
import { listPaymentMethods } from '../api/paymentMethods.js'
import { listEmployees } from '../api/staff.js'
import { listTables } from '../api/tables.js'
import { AuthContext } from '../auth/authContext.js'
import SalesHistoryPage from './SalesHistoryPage.jsx'

vi.mock('../api/history.js', () => ({ listSalesHistory: vi.fn(), downloadSalesHistory: vi.fn() }))
vi.mock('../api/paymentMethods.js')
vi.mock('../api/staff.js')
vi.mock('../api/tables.js')

const ME = { userId: 'me', email: 'admin@lapizzeta.co', role: 'ADMIN', isActive: true }
const W1 = 'w-1'
const W2 = 'w-2'
const CASH = 'm-cash'
const CARD = 'm-card'
const TODAY = { from: '2026-11-14', to: '2026-11-14', waiterId: '', tableId: '', paymentMethodId: '' }

const sale = (n, overrides = {}) => ({
  orderId: `${String(n).padStart(8, 'a')}-0000-4000-8000-000000000000`,
  reference: `REF00${n}`.slice(0, 6),
  tableId: 't-5',
  tableNumber: 5,
  waiterId: W1,
  openedAt: '2026-11-14T18:00:00.000Z',
  closedAt: '2026-11-14T19:22:00.000Z',
  itemsCount: 3,
  subtotal: 45000,
  discountAmount: 0,
  total: 45000,
  paymentMethodId: CASH,
  ...overrides,
})
const pageOf = (items, { total = items.length, page = 1 } = {}) => ({
  items,
  page,
  pageSize: 20,
  total,
  summary: {
    totalSales: items.reduce((s, i) => s + i.total, 0),
    ordersCount: total,
    averageTicket: total ? Math.round(items.reduce((s, i) => s + i.total, 0) / total) : 0,
  },
})

function renderPage() {
  const auth = { status: 'authenticated', user: ME, login: vi.fn(), logout: vi.fn() }
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={auth}>
        <SalesHistoryPage />
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

const lastCall = () => listSalesHistory.mock.calls.at(-1)

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 14, 23, 30)) // 14-nov, 11:30 p. m. hora local
  listSalesHistory.mockResolvedValue(
    pageOf([sale(1), sale(2, { tableNumber: 2, waiterId: W2, total: 82500, paymentMethodId: CARD })]),
  )
  listTables.mockResolvedValue([
    { tableId: 't-5', tableNumber: 5 },
    { tableId: 't-2', tableNumber: 2 },
  ])
  listEmployees.mockResolvedValue([
    { userId: W1, fullName: 'Carlos Ruiz' },
    { userId: W2, fullName: 'Ana Martínez' },
  ])
  listPaymentMethods.mockResolvedValue([
    { paymentMethodId: CASH, name: 'Efectivo' },
    { paymentMethodId: CARD, name: 'Tarjeta' },
  ])
})
afterEach(() => vi.useRealTimers())

describe('carga inicial', () => {
  it('titulo Historial de Ventas y pide HOY, pagina 1', async () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Historial de Ventas' })).toBeInTheDocument()
    await screen.findByRole('table')
    expect(listSalesHistory).toHaveBeenCalledWith(TODAY, { page: 1, pageSize: 20 })
    expect(screen.getByLabelText('Desde')).toHaveValue('2026-11-14')
    expect(screen.getByLabelText('Hasta')).toHaveValue('2026-11-14')
    expect(screen.getByRole('button', { name: 'Hoy' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('mientras carga no muestra tabla, resumen ni aviso de vacio', () => {
    listSalesHistory.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText('Total vendido')).not.toBeInTheDocument()
    expect(screen.queryByText('No hay ventas cerradas con estos filtros.')).not.toBeInTheDocument()
  })
})

describe('resumen (criterio: cambia con los filtros)', () => {
  it('total vendido, cuentas y ticket promedio del filtro', async () => {
    renderPage()
    const summary = await screen.findByRole('region', { name: 'Resumen del filtro' })
    expect(within(summary).getByText('Total vendido').nextSibling).toHaveTextContent('$127.500')
    expect(within(summary).getByText('Cuentas').nextSibling).toHaveTextContent('2')
    expect(within(summary).getByText('Ticket promedio').nextSibling).toHaveTextContent('$63.750')
  })

  it('al cambiar un filtro el resumen muestra el del nuevo filtro', async () => {
    renderPage()
    await screen.findByRole('table')
    listSalesHistory.mockResolvedValue(pageOf([sale(3, { total: 30000 })]))
    await userEvent.selectOptions(screen.getByLabelText('Método de pago'), CASH)
    const summary = screen.getByRole('region', { name: 'Resumen del filtro' })
    await waitFor(() =>
      expect(within(summary).getByText('Total vendido').nextSibling).toHaveTextContent('$30.000'),
    )
  })
})

describe('tabla (criterio: referencia, cierre, mesa, mesero, productos, total y metodo)', () => {
  it('cada venta con su referencia, fecha de cierre, mesa, NOMBRE del mesero, productos, total y metodo', async () => {
    renderPage()
    const rows = within(await screen.findByRole('table')).getAllByRole('row')
    expect(rows).toHaveLength(3) // encabezado + 2 ventas
    expect(
      within(rows[0])
        .getAllByRole('columnheader')
        .map((c) => c.textContent),
    ).toEqual(['Referencia', 'Cierre', 'Mesa', 'Mesero', 'Productos', 'Total', 'Método'])
    const cells = within(rows[1])
      .getAllByRole('cell')
      .map((c) => c.textContent)
    expect(cells[0]).toBe('#REF001')
    expect(cells[1]).toMatch(/14\/11\/2026/)
    expect(cells.slice(2)).toEqual(['Mesa 5', 'Carlos Ruiz', '3', '$45.000', 'Efectivo'])
    expect(within(rows[2]).getByText('Ana Martínez')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Tarjeta')).toBeInTheDocument()
  })

  it('si fallan las listas de nombres la tabla se muestra igual con nombres genericos', async () => {
    listEmployees.mockRejectedValue(new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'x'))
    listPaymentMethods.mockRejectedValue(new ApiError(500, 'X', 'x'))
    renderPage()
    await screen.findByRole('table')
    expect(screen.getAllByText('Sin perfil de empleado')).toHaveLength(2)
    expect(screen.getAllByText('Método sin nombre')).toHaveLength(2)
    expect(screen.getByText('$82.500')).toBeInTheDocument()
  })

  it('la tabla se puede desplazar con el teclado en pantallas angostas (region enfocable con nombre)', async () => {
    renderPage()
    const region = await screen.findByRole('region', { name: 'Ventas (desplazable)' })
    expect(region).toHaveAttribute('tabindex', '0')
  })
})

describe('filtros (criterio: cambiar un filtro reinicia a la pagina 1)', () => {
  it('mesero, mesa y metodo piden con ese filtro y en la pagina 1', async () => {
    listSalesHistory.mockResolvedValue(pageOf([sale(1)], { total: 45 }))
    renderPage()
    await screen.findByRole('table')
    await userEvent.click(screen.getByRole('button', { name: /Siguiente/ }))
    await waitFor(() => expect(lastCall()[1].page).toBe(2))

    await userEvent.selectOptions(screen.getByLabelText('Mesero'), W2)
    await waitFor(() =>
      expect(lastCall()).toEqual([
        { ...TODAY, waiterId: W2 },
        { page: 1, pageSize: 20 },
      ]),
    )

    await userEvent.selectOptions(screen.getByLabelText('Mesa'), 't-2')
    await waitFor(() => expect(lastCall()[0]).toMatchObject({ waiterId: W2, tableId: 't-2' }))

    await userEvent.selectOptions(screen.getByLabelText('Método de pago'), CARD)
    await waitFor(() => expect(lastCall()[0]).toMatchObject({ paymentMethodId: CARD }))
  })

  it('los selectores traen "Todos" y las opciones ordenadas (mesas por numero, meseros por nombre)', async () => {
    renderPage()
    await screen.findByRole('table')
    const tables = within(screen.getByLabelText('Mesa'))
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(tables).toEqual(['Todas las mesas', 'Mesa 2', 'Mesa 5'])
    await waitFor(() =>
      expect(
        within(screen.getByLabelText('Mesero'))
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['Todos los meseros', 'Ana Martínez', 'Carlos Ruiz']),
    )
  })

  it('los atajos de periodo cambian desde/hasta: Ayer, Esta semana (lunes a domingo) y Este mes', async () => {
    renderPage()
    await screen.findByRole('table')
    await userEvent.click(screen.getByRole('button', { name: 'Ayer' }))
    await waitFor(() => expect(lastCall()[0]).toMatchObject({ from: '2026-11-13', to: '2026-11-13' }))
    expect(screen.getByRole('button', { name: 'Ayer' })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(screen.getByRole('button', { name: 'Esta semana' }))
    await waitFor(() => expect(lastCall()[0]).toMatchObject({ from: '2026-11-09', to: '2026-11-15' }))

    await userEvent.click(screen.getByRole('button', { name: 'Este mes' }))
    await waitFor(() => expect(lastCall()[0]).toMatchObject({ from: '2026-11-01', to: '2026-11-30' }))
    expect(screen.getByLabelText('Desde')).toHaveValue('2026-11-01')
  })

  it('un rango propio no marca ningun atajo', async () => {
    renderPage()
    await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-11-02' } })
    await waitFor(() => expect(lastCall()[0]).toMatchObject({ from: '2026-11-02', to: '2026-11-14' }))
    for (const name of ['Hoy', 'Ayer', 'Esta semana', 'Este mes']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false')
    }
  })

  it('desde posterior a hasta: avisa junto a las fechas y no pide nada', async () => {
    renderPage()
    await screen.findByRole('table')
    const calls = listSalesHistory.mock.calls.length
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-11-20' } })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'La fecha desde no puede ser posterior a la fecha hasta.',
    )
    expect(screen.getByLabelText('Desde')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Desde')).toHaveAccessibleDescription(
      'La fecha desde no puede ser posterior a la fecha hasta.',
    )
    expect(listSalesHistory).toHaveBeenCalledTimes(calls)
  })

  it('Limpiar vuelve a HOY sin filtros; sin filtros activos esta deshabilitado', async () => {
    renderPage()
    await screen.findByRole('table')
    const clear = screen.getByRole('button', { name: /Limpiar/ })
    expect(clear).toBeDisabled()

    await userEvent.selectOptions(screen.getByLabelText('Mesa'), 't-5')
    await userEvent.click(screen.getByRole('button', { name: 'Ayer' }))
    expect(clear).toBeEnabled()

    await userEvent.click(clear)
    await waitFor(() => expect(lastCall()[0]).toEqual(TODAY))
    expect(screen.getByLabelText('Mesa')).toHaveValue('')
    expect(clear).toBeDisabled()
  })
})

describe('paginacion', () => {
  it('con mas de una pagina: "Mostrando 1–20 de 45", Pagina 1 de 3 y Siguiente pide la 2', async () => {
    listSalesHistory.mockResolvedValue(pageOf([sale(1)], { total: 45 }))
    renderPage()
    expect(await screen.findByText('Mostrando 1–20 de 45')).toBeInTheDocument()
    expect(screen.getByText('Página 1 de 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Anterior/ })).toBeDisabled()

    listSalesHistory.mockResolvedValue(pageOf([sale(21)], { total: 45, page: 2 }))
    await userEvent.click(screen.getByRole('button', { name: /Siguiente/ }))
    await waitFor(() => expect(lastCall()[1]).toEqual({ page: 2, pageSize: 20 }))
    expect(await screen.findByText('Mostrando 21–40 de 45')).toBeInTheDocument()
    expect(screen.getByText('Página 2 de 3')).toBeInTheDocument()
  })

  it('con una sola pagina muestra cuantas hay pero no los botones', async () => {
    renderPage()
    expect(await screen.findByText('Mostrando 1–2 de 2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Siguiente/ })).not.toBeInTheDocument()
  })
})

describe('estados (criterio: catalog-state)', () => {
  it('vacio: aviso con sugerencia, resumen en ceros y sin tabla', async () => {
    listSalesHistory.mockResolvedValue(pageOf([]))
    renderPage()
    expect(await screen.findByText('No hay ventas cerradas con estos filtros.')).toBeInTheDocument()
    expect(screen.getByText('Prueba con otro rango de fechas o quita algún filtro.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    const summary = screen.getByRole('region', { name: 'Resumen del filtro' })
    expect(within(summary).getByText('Total vendido').nextSibling).toHaveTextContent('$0')
  })

  it('error: mensaje y Reintentar vuelve a pedir', async () => {
    listSalesHistory.mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'x'))
    renderPage()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('No se pudo cargar el historial de ventas.')
    await userEvent.click(within(alert).getByRole('button', { name: /Reintentar/ }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('403: dice que no tiene permiso', async () => {
    listSalesHistory.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'x'))
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No tienes permiso para ver el historial de ventas.',
    )
  })
})
