import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/errors.js'
import * as ordersApi from '../api/orders.js'
import { AuthContext } from '../auth/authContext.js'
import { ToastProvider } from '../components/Toast.jsx'
import OrderDetailPage from './OrderDetailPage.jsx'

// "Cerrar mesa sin cobro" en el detalle de la orden: mesero asignado o ADMIN, con la orden abierta y sin productos activos.
vi.mock('../api/orders.js')
vi.mock('../hooks/useRealtimeEvent.js', () => ({ useRealtimeEvent: vi.fn() }))

const ORDER_ID = 'order-1'
const WAITER = { userId: 'user-1', email: 'mesero@lapizzeta.com', role: 'WAITER', isActive: true }
const ADMIN = { userId: 'user-9', email: 'admin@lapizzeta.com', role: 'ADMIN', isActive: true }

const makeItem = (itemId, status) => ({
  itemId,
  roundId: 'round-1',
  productId: `prod-${itemId}`,
  productName: `Producto ${itemId}`,
  unitPrice: 10000,
  quantity: 1,
  note: null,
  status,
  cancelledReason: status === 'cancelado' ? 'Error' : null,
})

const makeOrder = (items, status) => ({
  orderId: ORDER_ID,
  tableId: 'table-1',
  tableNumber: 2,
  waiterId: WAITER.userId,
  status,
  openedAt: new Date().toISOString(),
  closedAt: null,
  discountAmount: 0,
  rounds: [{ roundId: 'round-1', orderId: ORDER_ID, source: 'WAITER', items }],
})

function renderPage({ user = ADMIN, items = [], status = 'ABIERTA' } = {}) {
  ordersApi.getOrderDetail.mockResolvedValue(makeOrder(items, status))
  const auth = { status: 'authenticated', user, login: vi.fn(), logout: vi.fn() }
  return render(
    <MemoryRouter initialEntries={[`/mesero/mesas/${ORDER_ID}`]}>
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <Routes>
            <Route path="/mesero/mesas/:orderId" element={<OrderDetailPage />} />
            <Route path="/mesero/mesas" element={<p>Panel de mesas</p>} />
          </Routes>
        </ToastProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

const closeButton = () => screen.queryByRole('button', { name: /Cerrar mesa sin cobro/ })

beforeEach(() => {
  vi.resetAllMocks()
})

describe('OrderDetailPage: cerrar mesa sin cobro', () => {
  it('el mesero asignado también lo ve', async () => {
    renderPage({ user: WAITER })
    await screen.findByText('No hay ítems en esta orden.')

    expect(closeButton()).toBeEnabled()
  })

  it('un mesero que no es el asignado no lo ve', async () => {
    renderPage({ user: { ...WAITER, userId: 'user-2' } })
    await screen.findByText('No hay ítems en esta orden.')

    expect(closeButton()).toBeNull()
  })

  it('el ADMIN no lo ve con la mesa en cobro', async () => {
    renderPage({ status: 'EN_COBRO', items: [makeItem('i1', 'entregado')] })
    await screen.findByText('Producto i1')

    expect(closeButton()).toBeNull()
  })

  it('con productos activos está deshabilitado y explica que hay que anularlos', async () => {
    renderPage({ items: [makeItem('i1', 'pendiente'), makeItem('i2', 'cancelado')] })
    await screen.findByText('Producto i1')

    expect(closeButton()).toBeDisabled()
    expect(screen.getByText(/Anula los productos para poder cerrar la mesa/)).toBeInTheDocument()
  })

  it('sin productos activos: confirma, cierra y vuelve al panel de mesas', async () => {
    ordersApi.closeOrder.mockResolvedValue({ orderId: ORDER_ID, status: 'CERRADA' })
    const user = userEvent.setup()
    renderPage({ items: [makeItem('i2', 'cancelado')] })
    await screen.findByText('Producto i2')

    await user.click(closeButton())
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/La mesa 2 quedará libre sin registrar ningún pago/)).toBeInTheDocument()
    expect(ordersApi.closeOrder).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Sí, cerrar mesa' }))

    expect(ordersApi.closeOrder).toHaveBeenCalledWith(ORDER_ID)
    expect(await screen.findByText('Panel de mesas')).toBeInTheDocument()
    expect(screen.getByText('Mesa 2 cerrada sin cobro')).toBeInTheDocument()
  })

  it('cancelar el diálogo no cierra nada', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('No hay ítems en esta orden.')

    await user.click(closeButton())
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ordersApi.closeOrder).not.toHaveBeenCalled()
  })

  it('si el backend lo rechaza (409), muestra el motivo y recarga el detalle', async () => {
    ordersApi.closeOrder.mockRejectedValue(
      new ApiError(409, 'INVALID_TRANSITION', 'Anula los productos de la mesa antes de cerrarla sin cobro'),
    )
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('No hay ítems en esta orden.')

    await user.click(closeButton())
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, cerrar mesa' }))

    expect(
      await screen.findByText('Anula los productos de la mesa antes de cerrarla sin cobro'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Panel de mesas')).toBeNull()
    expect(ordersApi.getOrderDetail).toHaveBeenCalledTimes(2)
  })
})
