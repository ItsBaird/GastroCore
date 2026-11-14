import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/errors.js'
import * as menuApi from '../api/menu.js'
import * as qrApi from '../api/qrRequests.js'
import { AuthContext } from '../auth/authContext.js'
import { ToastProvider } from '../components/Toast.jsx'
import OrderTakingPage from './OrderTakingPage.jsx'

const inbox = { removeRequest: vi.fn(), reload: vi.fn() }
vi.mock('../hooks/useWaiterInbox.jsx', () => ({ useWaiterInbox: () => inbox }))

vi.mock('../api/menu.js')
vi.mock('../api/qrRequests.js')
vi.mock('../api/orders.js')
vi.mock('../hooks/useActiveShift.js', () => ({ useActiveShift: vi.fn() }))

const MENU = [
  {
    categoryId: 'c1',
    name: 'Pizzas',
    products: [
      { productId: 'p1', name: 'Pizzeta Pepperoni', description: '', price: 35000 },
      { productId: 'p2', name: 'Agua', description: '', price: 2000 },
    ],
  },
]
const REQUEST = {
  qrRequestId: 'q1',
  orderId: 'o-7',
  tableNumber: 7,
  items: [
    { productId: 'p1', quantity: 2, note: 'sin cebolla' },
    { productId: 'p2', quantity: 1 },
  ],
}

function renderAdjust(state = { request: REQUEST }) {
  const auth = { status: 'authenticated', user: { userId: 'w1', role: 'WAITER' }, login: vi.fn(), logout: vi.fn() }
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/mesero/solicitudes/q1/ajustar', state }]}>
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <Routes>
            <Route path="/mesero/solicitudes/:qrRequestId/ajustar" element={<OrderTakingPage />} />
            <Route path="/mesero/llamados" element={<p>Bandeja de llamados</p>} />
          </Routes>
        </ToastProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

const cart = () => within(screen.getByRole('complementary', { name: 'Pedido actual' }))

beforeEach(() => {
  vi.resetAllMocks()
  menuApi.getMenu.mockResolvedValue(MENU)
})

describe('OrderTakingPage: ajustar una solicitud QR (GC-QR-0003)', () => {
  it('el carrito arranca con lo que pidió el cliente', async () => {
    renderAdjust()

    expect(await screen.findByText('Ajustar solicitud — Mesa 7')).toBeInTheDocument()
    expect(await cart().findByText('Pizzeta Pepperoni')).toBeInTheDocument()
    expect(cart().getByText('Agua')).toBeInTheDocument()
    expect(cart().getByRole('button', { name: 'Confirmar solicitud' })).toBeEnabled()
  })

  it('confirmar con ajuste envía solo productId, quantity y note (sin precios) y vuelve a Llamados', async () => {
    qrApi.confirmQrRequest.mockResolvedValue({ round: { roundId: 'r1' } })
    const user = userEvent.setup()
    renderAdjust()
    await cart().findByText('Agua')

    // Quitar el agua
    const agua = cart().getByText('Agua').closest('.ot-cart-item, li, div')
    await user.click(within(agua.parentElement).getAllByRole('button').find((b) => /quitar|eliminar/i.test(b.getAttribute('aria-label') ?? '')))
    await user.click(cart().getByRole('button', { name: 'Confirmar solicitud' }))

    const [id, items] = qrApi.confirmQrRequest.mock.calls[0]
    expect(id).toBe('q1')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ productId: 'p1', quantity: 2, note: 'sin cebolla' })
    expect(await screen.findByText('Bandeja de llamados')).toBeInTheDocument()
    // Sale de la bandeja (que vive en el layout) para no verla al volver
    expect(inbox.removeRequest).toHaveBeenCalledWith('q1')
  })

  it('si ya fue resuelta (409) avisa y vuelve a Llamados', async () => {
    qrApi.confirmQrRequest.mockRejectedValue(new ApiError(409, 'INVALID_TRANSITION', 'La solicitud ya fue resuelta'))
    const user = userEvent.setup()
    renderAdjust()
    await cart().findByText('Agua')

    await user.click(cart().getByRole('button', { name: 'Confirmar solicitud' }))

    expect(await screen.findByText('Bandeja de llamados')).toBeInTheDocument()
    expect(inbox.reload).toHaveBeenCalled()
  })

  it('al recargar sin estado busca la solicitud entre las pendientes; si ya no está, lo dice', async () => {
    qrApi.listPendingQrRequests.mockResolvedValue([])
    renderAdjust(null)

    expect(
      await screen.findByText('Esta solicitud ya no está pendiente (se confirmó, se rechazó o la mesa cambió).'),
    ).toBeInTheDocument()
  })

  it('al recargar sin estado la encuentra entre las pendientes', async () => {
    qrApi.listPendingQrRequests.mockResolvedValue([REQUEST])
    renderAdjust(null)

    expect(await cart().findByText('Pizzeta Pepperoni')).toBeInTheDocument()
  })
})
