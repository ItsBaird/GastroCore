// GC-158. Confirmar el cierre de caja y listar los cierres (HU GC-RPT-0002): boton "Cerrar Caja", dialogo de
// confirmacion, estado de la caja, y el historial con su paginacion.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/errors.js'
import { listPaymentMethods } from '../api/paymentMethods.js'
import { confirmCashClose, getCashClosePreview, getCashClosure, listCashClosures } from '../api/reports.js'
import { listEmployees } from '../api/staff.js'
import { AuthContext } from '../auth/authContext.js'
import { ToastProvider } from '../components/Toast.jsx'
import CashClosePage from './CashClosePage.jsx'

vi.mock('../api/reports.js')
vi.mock('../api/paymentMethods.js')
vi.mock('../api/staff.js')

const ME = { userId: 'me', email: 'admin@lapizzeta.co', role: 'ADMIN', isActive: true }
const CASH = 'method-cash'
const ADMIN = 'admin-1'
const W1 = 'waiter-1'

const PREVIEW = {
  date: '2026-11-14',
  totalSales: 120000,
  tablesServed: 4,
  averageTicket: 30000,
  paymentBreakdown: [{ paymentMethodId: CASH, totalAmount: 120000, paymentCount: 4 }],
  topProducts: [{ rank: 1, productId: 'p1', productName: 'Pizza Margarita', quantitySold: 12 }],
  waiterBreakdown: [{ waiterId: W1, totalAmount: 120000 }],
}
const CLOSURE = {
  ...PREVIEW,
  closureId: 'c-14',
  confirmedBy: ADMIN,
  confirmedAt: '2026-11-14T23:30:00.000Z',
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
const row = (day, total, id = `c-${day}`) => ({
  closureId: id,
  date: day,
  totalSales: total,
  tablesServed: 3,
  averageTicket: 1,
  confirmedBy: ADMIN,
  confirmedAt: `${day}T23:00:00.000Z`,
})
const page = (items, total = items.length) => ({ items, page: 1, pageSize: 10, total })

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

const closeButton = () => screen.getByRole('button', { name: 'Cerrar Caja' })

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 14, 23, 30)) // 14-nov, 11:30 p. m. hora local
  getCashClosePreview.mockResolvedValue(PREVIEW)
  getCashClosure.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'x'))
  listCashClosures.mockResolvedValue(page([]))
  listPaymentMethods.mockResolvedValue([
    { paymentMethodId: CASH, name: 'Efectivo', isCash: true, isActive: true },
  ])
  listEmployees.mockResolvedValue([
    { userId: ADMIN, fullName: 'Marta Admin' },
    { userId: W1, fullName: 'Laura Gómez' },
  ])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('estado de la caja', () => {
  it('un dia sin cierre se anuncia como "Caja abierta" y el boton Cerrar Caja se puede usar', async () => {
    renderPage()
    expect(await screen.findByText('Caja abierta')).toBeInTheDocument()
    expect(closeButton()).toBeEnabled()
    expect(screen.queryByText('Este día ya está cerrado.')).not.toBeInTheDocument()
  })

  it('un dia cerrado muestra el consolidado CONFIRMADO, quien lo confirmo y cuando; no pide la vista previa', async () => {
    getCashClosure.mockResolvedValue(CLOSURE)
    renderPage()
    const banner = await screen.findByText('Caja cerrada')
    expect(banner.closest('div')).toHaveTextContent('confirmada por Marta Admin')
    expect(screen.getByText('$120.000', { selector: '.cc-total__value' })).toBeInTheDocument()
    expect(getCashClosure).toHaveBeenCalledWith('2026-11-14')
    expect(getCashClosePreview).not.toHaveBeenCalled()
  })

  it('un dia cerrado deshabilita Cerrar Caja y dice por que (con texto, no solo tooltip)', async () => {
    getCashClosure.mockResolvedValue(CLOSURE)
    renderPage()
    expect(await screen.findByText('Este día ya está cerrado.')).toBeInTheDocument()
    expect(closeButton()).toBeDisabled()
    expect(closeButton()).toHaveAccessibleDescription('Este día ya está cerrado.')
  })

  it('sin ordenes no se puede cerrar y lo explica', async () => {
    getCashClosePreview.mockResolvedValue(EMPTY)
    renderPage()
    expect(await screen.findByText('No hay órdenes para cerrar ese día.')).toBeInTheDocument()
    expect(closeButton()).toBeDisabled()
  })

  it('un dia futuro no se puede cerrar', async () => {
    renderPage()
    await screen.findByText('Caja abierta')
    getCashClosePreview.mockResolvedValue({ ...PREVIEW, date: '2026-11-20' })
    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-11-20' } })
    expect(await screen.findByText('Ese día todavía no empieza: no se puede cerrar.')).toBeInTheDocument()
    expect(closeButton()).toBeDisabled()
  })

  it('mientras carga el boton no se puede usar', () => {
    getCashClosure.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(closeButton()).toBeDisabled()
  })
})

describe('confirmar el cierre (criterio 1)', () => {
  async function openDialog() {
    renderPage()
    await screen.findByText('Caja abierta')
    await userEvent.click(closeButton())
    return screen.findByRole('dialog', { name: 'Confirmar cierre de caja' })
  }

  it('el dialogo resume que se cierra (fecha, total, mesas) y avisa que bloquea los cobros del dia', async () => {
    const dialog = await openDialog()
    expect(within(dialog).getByText('Vas a cerrar la caja del 14 de noviembre de 2026.')).toBeInTheDocument()
    expect(within(dialog).getByText('$120.000')).toBeInTheDocument()
    expect(within(dialog).getByText('Total de ventas')).toBeInTheDocument()
    expect(within(dialog).getByText('Mesas atendidas').nextSibling).toHaveTextContent('4')
    expect(within(dialog).getByText(/ya no se podrán registrar cobros de ese día/)).toBeInTheDocument()
    expect(confirmCashClose).not.toHaveBeenCalled()
  })

  it('Cancelar cierra el dialogo sin confirmar nada', async () => {
    const dialog = await openDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(confirmCashClose).not.toHaveBeenCalled()
  })

  it('Confirmar envia SOLO la fecha (R4), cierra el dialogo, avisa, pasa a "Caja cerrada" y recarga el historial', async () => {
    confirmCashClose.mockResolvedValue(CLOSURE)
    const dialog = await openDialog()
    listCashClosures.mockResolvedValue(page([row('2026-11-14', 120000)]))

    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar cierre' }))

    expect(confirmCashClose).toHaveBeenCalledTimes(1)
    expect(confirmCashClose).toHaveBeenCalledWith('2026-11-14')
    expect(await screen.findByText('Caja cerrada')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Cierre de caja confirmado')).toBeInTheDocument()
    expect(closeButton()).toBeDisabled()
    // el cierre nuevo aparece en el historial
    await waitFor(() => expect(listCashClosures).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('14/11/2026')).toBeInTheDocument()
  })

  it('mientras confirma el boton queda deshabilitado: un doble clic no manda dos cierres', async () => {
    let resolve
    confirmCashClose.mockReturnValue(new Promise((r) => (resolve = r)))
    const dialog = await openDialog()
    const confirmButton = within(dialog).getByRole('button', { name: 'Confirmar cierre' })
    await userEvent.click(confirmButton)
    expect(confirmButton).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toBeDisabled()
    await userEvent.click(confirmButton)
    expect(confirmCashClose).toHaveBeenCalledTimes(1)
    resolve(CLOSURE)
    await screen.findByText('Caja cerrada')
  })

  it('si falla, el dialogo sigue abierto con el error y se puede reintentar', async () => {
    confirmCashClose.mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'x'))
    const dialog = await openDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar cierre' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'No se pudo confirmar el cierre. Inténtalo de nuevo.',
    )
    expect(screen.getByText('Caja abierta')).toBeInTheDocument()
    expect(screen.queryByText('Cierre de caja confirmado')).not.toBeInTheDocument()

    confirmCashClose.mockResolvedValue(CLOSURE)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar cierre' }))
    expect(await screen.findByText('Caja cerrada')).toBeInTheDocument()
  })

  it('403: dice que no tiene permiso', async () => {
    confirmCashClose.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'x'))
    const dialog = await openDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar cierre' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'No tienes permiso para cerrar la caja.',
    )
  })
})

describe('dia ya cerrado por otra persona (criterio 2)', () => {
  it('409 DAY_CLOSED: cierra el dialogo, avisa y recarga mostrando el cierre confirmado', async () => {
    confirmCashClose.mockRejectedValue(new ApiError(409, 'DAY_CLOSED', 'x'))
    renderPage()
    await screen.findByText('Caja abierta')
    await userEvent.click(closeButton())
    const dialog = await screen.findByRole('dialog')
    getCashClosure.mockResolvedValue(CLOSURE) // mientras tanto alguien mas cerro ese dia

    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar cierre' }))

    expect(await screen.findByText('Caja cerrada')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Ese día ya fue cerrado. Actualizamos la pantalla.')).toBeInTheDocument()
    expect(closeButton()).toBeDisabled()
  })
})

describe('historial de cierres', () => {
  it('lista fecha (dd/mm/aaaa), responsable por NOMBRE, total y estado Cerrado', async () => {
    listCashClosures.mockResolvedValue(page([row('2026-11-13', 980000), row('2026-11-12', 1420000)]))
    renderPage()
    const history = (await screen.findByRole('heading', { name: 'Historial de Cierres' })).closest('section')
    const rows = await within(history).findAllByRole('row')
    // encabezado + 2 cierres
    expect(rows).toHaveLength(3)
    expect(within(rows[1]).getByText('13/11/2026')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Marta Admin')).toBeInTheDocument()
    expect(within(rows[1]).getByText('$980.000')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Cerrado')).toBeInTheDocument()
    expect(within(rows[2]).getByText('12/11/2026')).toBeInTheDocument()
    expect(within(rows[2]).getByText('$1.420.000')).toBeInTheDocument()
  })

  it('el responsable sin perfil de empleado se muestra como Administrador', async () => {
    listEmployees.mockResolvedValue([])
    listCashClosures.mockResolvedValue(page([row('2026-11-13', 1000)]))
    renderPage()
    const history = (await screen.findByRole('heading', { name: 'Historial de Cierres' })).closest('section')
    expect(await within(history).findByText('Administrador')).toBeInTheDocument()
  })

  it('sin cierres avisa en lugar de mostrar una tabla vacia', async () => {
    renderPage()
    expect(await screen.findByText('Todavía no hay cierres confirmados.')).toBeInTheDocument()
  })

  it('elegir la fecha de una fila abre ESE cierre', async () => {
    listCashClosures.mockResolvedValue(page([row('2026-11-13', 980000)]))
    renderPage()
    await screen.findByText('Caja abierta')
    getCashClosure.mockResolvedValue({
      ...CLOSURE,
      date: '2026-11-13',
      closureId: 'c-13',
      totalSales: 980000,
    })

    await userEvent.click(
      await screen.findByRole('button', { name: 'Ver el cierre del 13 de noviembre de 2026' }),
    )

    expect(await screen.findByText('Caja cerrada')).toBeInTheDocument()
    expect(getCashClosure).toHaveBeenLastCalledWith('2026-11-13')
    expect(screen.getByLabelText('Fecha')).toHaveValue('2026-11-13')
    expect(screen.getByText('$980.000', { selector: '.cc-total__value' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ver el cierre del 13 de noviembre de 2026' })).toHaveAttribute(
      'aria-current',
      'date',
    )
  })

  it('con mas de una pagina muestra la paginacion y Siguiente pide la pagina 2', async () => {
    listCashClosures.mockResolvedValue(page([row('2026-11-13', 1000)], 25))
    renderPage()
    expect(await screen.findByText('Página 1 de 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Anterior/ })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: /Siguiente/ }))
    await waitFor(() => expect(listCashClosures).toHaveBeenLastCalledWith({ page: 2, pageSize: 10 }))
    expect(await screen.findByText('Página 2 de 3')).toBeInTheDocument()
  })

  it('con una sola pagina no muestra paginacion', async () => {
    listCashClosures.mockResolvedValue(page([row('2026-11-13', 1000)], 1))
    renderPage()
    await screen.findByText('13/11/2026')
    expect(screen.queryByRole('navigation', { name: 'Paginación del historial' })).not.toBeInTheDocument()
  })

  it('si falla muestra el error DENTRO del historial y Reintentar lo vuelve a pedir; el resumen sigue visible', async () => {
    listCashClosures.mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'x'))
    renderPage()
    const history = (await screen.findByRole('heading', { name: 'Historial de Cierres' })).closest('section')
    expect(await within(history).findByRole('alert')).toHaveTextContent(
      'No se pudo cargar el historial de cierres.',
    )
    expect(screen.getByRole('heading', { name: 'Resumen del Día' })).toBeInTheDocument()

    listCashClosures.mockResolvedValue(page([row('2026-11-13', 1000)]))
    await userEvent.click(within(history).getByRole('button', { name: /Reintentar/ }))
    expect(await within(history).findByText('13/11/2026')).toBeInTheDocument()
  })
})

describe('errores al cargar el dia', () => {
  it('si falla preguntar por el cierre (no es un 404) muestra el error de la pantalla', async () => {
    getCashClosure.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'x'))
    renderPage()
    expect(await screen.findAllByRole('alert')).not.toHaveLength(0)
    expect(screen.queryByText('Caja abierta')).not.toBeInTheDocument()
    expect(closeButton()).toBeDisabled()
  })
})
