import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/errors.js'
import * as ordersApi from '../api/orders.js'
import * as tablesStatusApi from '../api/tablesStatus.js'
import { AuthContext } from '../auth/authContext.js'
import { ToastProvider } from '../components/Toast.jsx'
import { useActiveShift } from '../hooks/useActiveShift.js'
import WaiterTablesPanelPage from './WaiterTablesPanelPage.jsx'

// Mis Mesas: boton para cerrar sin cobro una mesa abierta sin pedido (al lado de "Tomar Pedido").
vi.mock('../api/tablesStatus.js')
vi.mock('../api/orders.js')
vi.mock('../hooks/useTableStatusSocket.js', () => ({ useTableStatusSocket: vi.fn() }))
vi.mock('../hooks/useActiveShift.js', () => ({ useActiveShift: vi.fn() }))
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => vi.fn(),
}))

const ME = { userId: 'user-1', email: 'mesero@lapizzeta.com', role: 'WAITER', isActive: true }
const ADMIN = { userId: 'admin-1', email: 'admin@lapizzeta.com', role: 'ADMIN', isActive: true }

const empty = (n, waiterId = 'user-1') => ({
  tableId: `t${n}`,
  tableNumber: n,
  status: 'ocupada',
  orderId: `o${n}`,
  waiterId,
  pendingCalls: [],
  itemsCount: 0,
})

function renderPage(tables, user = ME) {
  tablesStatusApi.listTableStatuses.mockResolvedValue(tables)
  const auth = { status: 'authenticated', user, login: vi.fn(), logout: vi.fn() }
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <WaiterTablesPanelPage />
        </ToastProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

const findCard = (n) => screen.findByRole('article', { name: new RegExp(`^Mesa ${n},`) })
const closeIn = (cardEl, n) =>
  within(cardEl).queryByRole('button', { name: `Cerrar mesa ${n} sin cobro` })

beforeEach(() => {
  vi.resetAllMocks()
  useActiveShift.mockReturnValue({ status: 'active', shift: null })
})

describe('Mis Mesas: cerrar sin cobro una mesa abierta sin pedido', () => {
  it('mi mesa sin pedido: "Tomar Pedido" y al lado el botón de cerrar', async () => {
    renderPage([empty(10)])
    const cardEl = await findCard(10)

    expect(within(cardEl).getByRole('button', { name: 'Mesa 10, tomar pedido' })).toBeInTheDocument()
    expect(closeIn(cardEl, 10)).toBeInTheDocument()
  })

  it('con pedido ("Ver Detalle"), libre o en cobro no aparece', async () => {
    renderPage([
      { ...empty(2), itemsCount: 3 },
      { tableId: 't1', tableNumber: 1, status: 'libre', pendingCalls: [] },
      { ...empty(3), status: 'en_cobro' },
    ])

    expect(closeIn(await findCard(2), 2)).toBeNull()
    expect(closeIn(await findCard(1), 1)).toBeNull()
    expect(closeIn(await findCard(3), 3)).toBeNull()
  })

  it('la mesa vacía de otro mesero no la puede cerrar; el ADMIN sí', async () => {
    const { unmount } = renderPage([empty(7, 'user-2')])
    expect(closeIn(await findCard(7), 7)).toBeNull()
    unmount()

    renderPage([empty(7, 'user-2')], ADMIN)
    expect(closeIn(await findCard(7), 7)).toBeInTheDocument()
  })

  it('confirma, cierra y la mesa pasa a libre', async () => {
    ordersApi.closeOrder.mockResolvedValue({ orderId: 'o10', status: 'CERRADA' })
    const user = userEvent.setup()
    renderPage([empty(10)])

    await user.click(closeIn(await findCard(10), 10))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/La mesa 10 quedará libre sin registrar ningún pago/)).toBeInTheDocument()
    expect(ordersApi.closeOrder).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Sí, cerrar mesa' }))

    expect(ordersApi.closeOrder).toHaveBeenCalledWith('o10')
    const cardEl = await screen.findByRole('article', { name: 'Mesa 10, Libre' })
    expect(within(cardEl).getByRole('button', { name: 'Mesa 10, abrir mesa' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('cancelar no cierra nada', async () => {
    const user = userEvent.setup()
    renderPage([empty(10)])

    await user.click(closeIn(await findCard(10), 10))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }))

    expect(ordersApi.closeOrder).not.toHaveBeenCalled()
    expect(closeIn(await findCard(10), 10)).toBeInTheDocument()
  })

  it('si el backend lo rechaza (le agregaron un pedido), muestra el motivo y recarga las mesas', async () => {
    ordersApi.closeOrder.mockRejectedValue(
      new ApiError(409, 'INVALID_TRANSITION', 'Anula los productos de la mesa antes de cerrarla sin cobro'),
    )
    const user = userEvent.setup()
    renderPage([empty(10)])

    await user.click(closeIn(await findCard(10), 10))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, cerrar mesa' }))

    expect(
      await screen.findByText('Anula los productos de la mesa antes de cerrarla sin cobro'),
    ).toBeInTheDocument()
    expect(tablesStatusApi.listTableStatuses).toHaveBeenCalledTimes(2)
  })
})
