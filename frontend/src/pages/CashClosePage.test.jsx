import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listPaymentMethods } from '../api/paymentMethods.js'
import { ApiError } from '../api/errors.js'
import { getCashClosePreview, getCashClosure, listCashClosures } from '../api/reports.js'
import { listEmployees } from '../api/staff.js'
import { AuthContext } from '../auth/authContext.js'
import { ToastProvider } from '../components/Toast.jsx'
import CashClosePage from './CashClosePage.jsx'

vi.mock('../api/reports.js')
vi.mock('../api/paymentMethods.js')
vi.mock('../api/staff.js')

const ME = { userId: 'me', email: 'admin@lapizzeta.co', role: 'ADMIN', isActive: true }
const CASH = 'method-cash'
const CARD = 'method-card'
const W1 = 'waiter-1'
const W2 = 'waiter-2'

const PREVIEW = {
  date: '2026-11-14',
  totalSales: 120000,
  tablesServed: 4,
  averageTicket: 30000,
  paymentBreakdown: [
    { paymentMethodId: CASH, totalAmount: 81000, paymentCount: 2 },
    { paymentMethodId: CARD, totalAmount: 39000, paymentCount: 2 },
  ],
  topProducts: [
    { rank: 1, productId: 'p1', productName: 'Pizza Margarita', quantitySold: 12 },
    { rank: 2, productId: 'p2', productName: 'Limonada', quantitySold: 9 },
  ],
  waiterBreakdown: [
    { waiterId: W1, totalAmount: 81000 },
    { waiterId: W2, totalAmount: 39000 },
  ],
}
const EMPTY = {
  date: '2026-11-14',
  totalSales: 0,
  tablesServed: 0,
  averageTicket: 0,
  paymentBreakdown: [],
  topProducts: [],
  waiterBreakdown: [],
}

function renderPage() {
  const auth = { status: 'authenticated', user: ME, login: vi.fn(), logout: vi.fn() }
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <CashClosePage />
        </ToastProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  // Solo se simula Date: los temporizadores reales siguen funcionando para waitFor
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 14, 23, 30)) // 14-nov, 11:30 p. m. hora local
  getCashClosePreview.mockResolvedValue(PREVIEW)
  // Por defecto el dia esta ABIERTO (404) y no hay cierres en el historial
  getCashClosure.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'x'))
  listCashClosures.mockResolvedValue({ items: [], page: 1, pageSize: 10, total: 0 })
  listPaymentMethods.mockResolvedValue([
    { paymentMethodId: CASH, name: 'Efectivo', isCash: true, isActive: true },
    { paymentMethodId: CARD, name: 'Tarjeta débito', isCash: false, isActive: true },
  ])
  listEmployees.mockResolvedValue([
    { userId: W1, fullName: 'Laura Gómez' },
    { userId: W2, fullName: 'Carlos Ruiz' },
  ])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CashClosePage · carga', () => {
  it('pide la vista previa de HOY en hora local (aunque en UTC ya sea el dia siguiente)', async () => {
    renderPage()
    await screen.findByText('Resumen del Día')
    expect(getCashClosePreview).toHaveBeenCalledWith('2026-11-14')
    expect(screen.getByLabelText('Fecha')).toHaveValue('2026-11-14')
  })

  it('mientras carga no muestra cifras ni el aviso de dia sin ordenes', async () => {
    getCashClosePreview.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.queryByText('Resumen del Día')).not.toBeInTheDocument()
    expect(screen.queryByText('No hay órdenes para cerrar')).not.toBeInTheDocument()
  })

  it('el titulo de la pantalla es Cierre de Caja', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Cierre de Caja' })).toBeInTheDocument()
  })
})

describe('CashClosePage · con órdenes (criterio 1)', () => {
  it('muestra el resumen: fecha en palabras, total de ventas, mesas atendidas y ticket promedio', async () => {
    renderPage()
    const summary = (await screen.findByRole('heading', { name: 'Resumen del Día' })).closest('section')
    expect(within(summary).getByText('14 de noviembre de 2026')).toBeInTheDocument()
    expect(within(summary).getByText('Total de ventas')).toBeInTheDocument()
    expect(within(summary).getByText('$120.000')).toBeInTheDocument()
    expect(within(summary).getByText('Mesas atendidas').nextSibling).toHaveTextContent('4')
    expect(within(summary).getByText('Ticket promedio').nextSibling).toHaveTextContent('$30.000')
  })

  it('el desglose por metodo usa los NOMBRES, con cuantos pagos y cuanto se cobro', async () => {
    renderPage()
    const summary = (await screen.findByRole('heading', { name: 'Resumen del Día' })).closest('section')
    const rows = await within(summary).findAllByRole('row')
    // encabezado + 2 metodos
    expect(within(rows[1]).getByText('Efectivo')).toBeInTheDocument()
    expect(within(rows[1]).getByText('2')).toBeInTheDocument()
    expect(within(rows[1]).getByText('$81.000')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Tarjeta débito')).toBeInTheDocument()
    expect(within(rows[2]).getByText('$39.000')).toBeInTheDocument()
  })

  it('el top de platos viene numerado con sus unidades', async () => {
    renderPage()
    const top = (await screen.findByRole('heading', { name: 'Platos más vendidos' })).closest('section')
    const rows = within(top).getAllByRole('row')
    expect(within(rows[1]).getByText('1')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Pizza Margarita')).toBeInTheDocument()
    expect(within(rows[1]).getByText('12')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Limonada')).toBeInTheDocument()
  })

  it('los ingresos por mesero usan el NOMBRE y aclaran que son del que abrio la mesa', async () => {
    renderPage()
    const waiters = (await screen.findByRole('heading', { name: 'Ingresos por mesero' })).closest('section')
    expect(within(waiters).getByText('Atribuidos al mesero que abrió la mesa')).toBeInTheDocument()
    await within(waiters).findByText('Laura Gómez')
    expect(within(waiters).getByText('$81.000')).toBeInTheDocument()
    expect(within(waiters).getByText('Carlos Ruiz')).toBeInTheDocument()
    expect(within(waiters).getByText('$39.000')).toBeInTheDocument()
  })

  it('las tablas tienen encabezados de columna y los numeros van aparte del texto', async () => {
    renderPage()
    await screen.findByText('Resumen del Día')
    expect(screen.getAllByRole('table')).toHaveLength(3)
    expect(screen.getAllByRole('columnheader', { name: 'Total' })).toHaveLength(2)
  })

  it('un top vacio con ventas avisa en lugar de mostrar una tabla sin filas', async () => {
    getCashClosePreview.mockResolvedValue({ ...PREVIEW, topProducts: [] })
    renderPage()
    expect(await screen.findByText('Ningún plato vendido en esta fecha.')).toBeInTheDocument()
  })
})

describe('CashClosePage · nombres', () => {
  it('un metodo o mesero que no aparece en su lista se muestra con un nombre generico', async () => {
    listPaymentMethods.mockResolvedValue([])
    listEmployees.mockResolvedValue([{ userId: W1, fullName: 'Laura Gómez' }])
    renderPage()
    await screen.findByText('Laura Gómez')
    expect(screen.getAllByText('Método sin nombre')).toHaveLength(2)
    expect(screen.getByText('Sin perfil de empleado')).toBeInTheDocument()
  })

  it('si fallan las listas de nombres la pantalla igual muestra los montos', async () => {
    listPaymentMethods.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'x'))
    listEmployees.mockRejectedValue(new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'x'))
    renderPage()
    expect(await screen.findByText('$120.000')).toBeInTheDocument()
    expect(screen.getAllByText('Método sin nombre')).toHaveLength(2)
    expect(screen.getAllByText('Sin perfil de empleado')).toHaveLength(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('CashClosePage · sin órdenes (criterio 2)', () => {
  it('avisa que no hay ordenes para cerrar, con la fecha, y no muestra cifras', async () => {
    getCashClosePreview.mockResolvedValue(EMPTY)
    renderPage()
    expect(await screen.findByText('No hay órdenes para cerrar')).toBeInTheDocument()
    expect(screen.getByText('No se cerró ninguna cuenta el 14 de noviembre de 2026.')).toBeInTheDocument()
    expect(screen.queryByText('Resumen del Día')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})

describe('CashClosePage · errores', () => {
  it('si falla muestra el error y Reintentar vuelve a pedirla', async () => {
    getCashClosePreview.mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'x'))
    renderPage()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('No se pudo cargar la vista previa del cierre de caja.')

    await userEvent.click(within(alert).getByRole('button', { name: /Reintentar/ }))
    expect(await screen.findByText('Resumen del Día')).toBeInTheDocument()
    expect(getCashClosePreview).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('403: dice que no tiene permiso', async () => {
    getCashClosePreview.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'x'))
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No tienes permiso para ver el cierre de caja.',
    )
  })

  it('400: dice que la fecha no es valida', async () => {
    getCashClosePreview.mockRejectedValue(new ApiError(400, 'VALIDATION_ERROR', 'x'))
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('La fecha seleccionada no es válida.')
  })
})

describe('CashClosePage · fecha', () => {
  it('al elegir otra fecha vuelve a pedir la vista previa de ESE dia', async () => {
    renderPage()
    await screen.findByText('Resumen del Día')
    getCashClosePreview.mockResolvedValue({ ...EMPTY, date: '2026-11-10' })

    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-11-10' } })

    expect(
      await screen.findByText('No se cerró ninguna cuenta el 10 de noviembre de 2026.'),
    ).toBeInTheDocument()
    expect(getCashClosePreview).toHaveBeenLastCalledWith('2026-11-10')
  })

  it('si se borra el campo no se pide nada y queda la fecha anterior', async () => {
    renderPage()
    await screen.findByText('Resumen del Día')
    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '' } })
    expect(getCashClosePreview).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Fecha')).toHaveValue('2026-11-14')
    expect(screen.getByText('Resumen del Día')).toBeInTheDocument()
  })

  it('elegir la misma fecha no deja la pantalla cargando para siempre', async () => {
    renderPage()
    await screen.findByText('Resumen del Día')
    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-11-14' } })
    expect(screen.getByText('Resumen del Día')).toBeInTheDocument()
    expect(getCashClosePreview).toHaveBeenCalledTimes(1)
  })

  it('una respuesta vieja (de otra fecha) no pisa a la nueva', async () => {
    let resolveFirst
    getCashClosePreview.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
    renderPage()
    // mientras la de hoy sigue pendiente, el usuario elige otro dia
    getCashClosePreview.mockResolvedValueOnce({ ...EMPTY, date: '2026-11-10' })
    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-11-10' } })
    await screen.findByText('No hay órdenes para cerrar')

    // llega tarde la de hoy: se descarta
    await act(async () => resolveFirst(PREVIEW))
    expect(screen.getByText('No hay órdenes para cerrar')).toBeInTheDocument()
    expect(screen.queryByText('Resumen del Día')).not.toBeInTheDocument()
  })

  it('Actualizar vuelve a pedir la misma fecha', async () => {
    renderPage()
    await screen.findByText('Resumen del Día')
    await userEvent.click(screen.getByRole('button', { name: /Actualizar/ }))
    await waitFor(() => expect(getCashClosePreview).toHaveBeenCalledTimes(2))
    expect(getCashClosePreview).toHaveBeenLastCalledWith('2026-11-14')
    expect(await screen.findByText('Resumen del Día')).toBeInTheDocument()
  })
})
