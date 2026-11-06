import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/errors.js'
import * as ordersApi from '../api/orders.js'
import { AuthContext } from '../auth/authContext.js'
import { ToastProvider } from '../components/Toast.jsx'
import OrderDetailPage from './OrderDetailPage.jsx'

vi.mock('../api/orders.js')
vi.mock('../hooks/useRealtimeEvent.js', () => ({ useRealtimeEvent: vi.fn() }))

const { useRealtimeEvent } = await import('../hooks/useRealtimeEvent.js')

const ORDER_ID = 'order-1'
const WAITER = { userId: 'user-1', email: 'mesero@lapizzeta.com', role: 'WAITER', isActive: true }
const ADMIN = { userId: 'user-9', email: 'admin@lapizzeta.com', role: 'ADMIN', isActive: true }

function makeItem(itemId, status, overrides = {}) {
  return {
    itemId,
    roundId: 'round-1',
    productId: `prod-${itemId}`,
    productName: `Producto ${itemId}`,
    unitPrice: 10000,
    quantity: 1,
    note: null,
    status,
    preparationStartedAt: null,
    readyAt: null,
    deliveredAt: null,
    cancelledReason: null,
    cancelledBy: null,
    ...overrides,
  }
}

function makeOrder(items) {
  return {
    orderId: ORDER_ID,
    tableId: 'table-1',
    tableNumber: 2,
    waiterId: WAITER.userId,
    status: 'ABIERTA',
    openedAt: new Date().toISOString(),
    closedAt: null,
    discountAmount: 0,
    rounds: [{ roundId: 'round-1', orderId: ORDER_ID, source: 'WAITER', items }],
  }
}

function renderPage({ user = WAITER, items = [makeItem('i1', 'pendiente')] } = {}) {
  ordersApi.getOrderDetail.mockResolvedValue(makeOrder(items))
  const auth = { status: 'authenticated', user, login: vi.fn(), logout: vi.fn() }
  return render(
    <MemoryRouter initialEntries={[`/mesero/mesas/${ORDER_ID}`]}>
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <Routes>
            <Route path="/mesero/mesas/:orderId" element={<OrderDetailPage />} />
          </Routes>
        </ToastProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

const rowOf = (name) => screen.getByText(name).closest('.od-item-row')
const anularIn = (name) => within(rowOf(name)).queryByRole('button', { name: /anular/i })

beforeEach(() => {
  vi.resetAllMocks()
})

describe('OrderDetailPage — visibilidad de "Anular"', () => {
  const STATES = ['pendiente', 'en_preparacion', 'listo', 'entregado', 'cancelado']

  it('el mesero solo la ve en los ítems pendientes', async () => {
    renderPage({ user: WAITER, items: STATES.map((s, i) => makeItem(`i${i}`, s)) })
    await screen.findByText('Producto i0')

    expect(anularIn('Producto i0')).toBeInTheDocument() // pendiente
    expect(anularIn('Producto i1')).toBeNull() // en_preparacion
    expect(anularIn('Producto i2')).toBeNull() // listo
    expect(anularIn('Producto i3')).toBeNull() // entregado
    expect(anularIn('Producto i4')).toBeNull() // cancelado
  })

  it('el administrador la ve en pendiente, en preparación y listo', async () => {
    renderPage({ user: ADMIN, items: STATES.map((s, i) => makeItem(`i${i}`, s)) })
    await screen.findByText('Producto i0')

    expect(anularIn('Producto i0')).toBeInTheDocument()
    expect(anularIn('Producto i1')).toBeInTheDocument()
    expect(anularIn('Producto i2')).toBeInTheDocument()
    expect(anularIn('Producto i3')).toBeNull() // entregado
    expect(anularIn('Producto i4')).toBeNull() // cancelado
  })
})

describe('OrderDetailPage — ítems cancelados', () => {
  it('siguen a la vista con su píldora, el motivo y quién anuló', async () => {
    renderPage({
      user: WAITER,
      items: [
        makeItem('i1', 'cancelado', {
          cancelledReason: 'El cliente cambió de opinión',
          cancelledBy: WAITER.userId,
        }),
      ],
    })
    await screen.findByText('Producto i1')

    expect(screen.getByText('Cancelado', { selector: '.od-pill' })).toBeInTheDocument()
    expect(screen.getByText(/Anulado por ti/)).toBeInTheDocument()
    expect(screen.getByText(/El cliente cambió de opinión/)).toBeInTheDocument()
    expect(rowOf('Producto i1')).toHaveClass('od-item-row--cancelado')
  })

  // El tachado va en un span propio: si cuelga de .od-item-name, la linea del padre se propaga
  // a los descendientes y el motivo tambien sale tachado (el hijo no puede quitarsela).
  it('tacha solo el nombre, en un span aparte del motivo', async () => {
    renderPage({
      user: WAITER,
      items: [makeItem('i1', 'cancelado', { cancelledReason: 'Sin existencias', cancelledBy: 'otro' })],
    })
    await screen.findByText('Producto i1')

    expect(screen.getByText('Producto i1')).toHaveClass('od-item-name__text')
    expect(screen.getByText(/Sin existencias/)).toHaveClass('od-item-reason')
  })

  it('no dice "por ti" cuando lo anuló otra persona', async () => {
    renderPage({
      user: WAITER,
      items: [makeItem('i1', 'cancelado', { cancelledReason: 'Sin existencias', cancelledBy: 'otro' })],
    })
    await screen.findByText('Producto i1')

    expect(screen.queryByText(/Anulado por ti/)).toBeNull()
    expect(screen.getByText(/Sin existencias/)).toBeInTheDocument()
  })

  it('quedan fuera del subtotal, del total y del conteo de ítems', async () => {
    renderPage({
      user: WAITER,
      items: [
        makeItem('i1', 'pendiente', { quantity: 2, unitPrice: 10000 }),
        makeItem('i2', 'cancelado', { quantity: 3, unitPrice: 50000, cancelledReason: 'x' }),
      ],
    })
    await screen.findByText('Producto i1')

    // 2 x 10.000 = 20.000 en la linea, el subtotal y el total; los 150.000 cancelados no cuentan
    expect(screen.getAllByText('$20.000')).toHaveLength(3)
    expect(screen.getByText('$150.000')).toBeInTheDocument() // la linea anulada si muestra su importe
    expect(screen.queryByText('$170.000')).toBeNull()
    expect(screen.getByText('Anulados (no se cobran):')).toBeInTheDocument()
  })
})

describe('OrderDetailPage — modal de anulación', () => {
  const openModal = async () => {
    const user = userEvent.setup()
    renderPage({ user: WAITER, items: [makeItem('i1', 'pendiente', { note: 'Sin cebolla' })] })
    await screen.findByText('Producto i1')
    await user.click(anularIn('Producto i1'))
    return user
  }

  it('muestra el producto, la cantidad y la nota como contexto', async () => {
    await openModal()

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Producto i1')).toBeInTheDocument()
    expect(within(dialog).getByText(/×1/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Sin cebolla/)).toBeInTheDocument()
  })

  it('empieza con el botón deshabilitado y lo habilita al escribir un motivo', async () => {
    const user = await openModal()

    const confirm = screen.getByRole('button', { name: 'Anular ítem' })
    expect(confirm).toBeDisabled()

    await user.type(screen.getByRole('textbox'), 'Se cayó el plato')
    expect(confirm).toBeEnabled()
  })

  it('un motivo de solo espacios no habilita el botón', async () => {
    const user = await openModal()

    await user.type(screen.getByRole('textbox'), '    ')
    expect(screen.getByRole('button', { name: 'Anular ítem' })).toBeDisabled()
  })

  it('limita el motivo a 255 caracteres y lleva la cuenta', async () => {
    const user = await openModal()

    const textarea = screen.getByRole('textbox')
    expect(textarea).toHaveAttribute('maxLength', '255')

    await user.type(textarea, 'abc')
    expect(screen.getByText('3/255')).toBeInTheDocument()
  })

  it('envía solo el motivo recortado, nunca precios ni totales (R4)', async () => {
    const user = await openModal()
    ordersApi.cancelItem.mockResolvedValue(
      makeItem('i1', 'cancelado', { cancelledReason: 'Se cayó el plato', cancelledBy: WAITER.userId }),
    )

    await user.type(screen.getByRole('textbox'), '  Se cayó el plato  ')
    await user.click(screen.getByRole('button', { name: 'Anular ítem' }))

    expect(ordersApi.cancelItem).toHaveBeenCalledWith('i1', 'Se cayó el plato')
    expect(ordersApi.cancelItem).toHaveBeenCalledTimes(1)
  })

  it('al confirmar, la línea pasa a Cancelado y el total se recalcula', async () => {
    const user = userEvent.setup()
    renderPage({
      user: WAITER,
      items: [makeItem('i1', 'pendiente', { quantity: 1, unitPrice: 10000 })],
    })
    await screen.findByText('Producto i1')
    ordersApi.cancelItem.mockResolvedValue(
      makeItem('i1', 'cancelado', { cancelledReason: 'Ya no lo quiere', cancelledBy: WAITER.userId }),
    )

    await user.click(anularIn('Producto i1'))
    await user.type(screen.getByRole('textbox'), 'Ya no lo quiere')
    await user.click(screen.getByRole('button', { name: 'Anular ítem' }))

    expect(await screen.findByText('Cancelado', { selector: '.od-pill' })).toBeInTheDocument()
    expect(screen.getAllByText('$0')).not.toHaveLength(0)
    expect(await screen.findByText(/Se anuló Producto i1/)).toBeInTheDocument()
    expect(anularIn('Producto i1')).toBeNull()
  })
})

describe('OrderDetailPage — errores al anular', () => {
  const failWith = async (error) => {
    const user = userEvent.setup()
    renderPage({ user: WAITER, items: [makeItem('i1', 'pendiente')] })
    await screen.findByText('Producto i1')
    ordersApi.cancelItem.mockRejectedValue(error)

    await user.click(anularIn('Producto i1'))
    await user.type(screen.getByRole('textbox'), 'motivo')
    await user.click(screen.getByRole('button', { name: 'Anular ítem' }))
    return user
  }

  it('403 deja el modal abierto con el mensaje del servidor', async () => {
    await failWith(
      new ApiError(403, 'FORBIDDEN', 'Solo el ADMIN puede anular ítems fuera del estado pendiente'),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(/Solo el ADMIN puede anular/)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('409 avisa y recarga el detalle por detrás', async () => {
    await failWith(new ApiError(409, 'INVALID_TRANSITION', 'El ítem ya fue anulado'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/ya fue anulado/)
    expect(ordersApi.getOrderDetail).toHaveBeenCalledTimes(2)
  })

  it('404 avisa y recarga el detalle', async () => {
    await failWith(new ApiError(404, 'NOT_FOUND', 'El ítem no existe'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/no existe/)
    expect(ordersApi.getOrderDetail).toHaveBeenCalledTimes(2)
  })

  it('un error de red avisa sin recargar y permite reintentar', async () => {
    await failWith(new ApiError(0, 'NETWORK_ERROR', 'No se pudo conectar con el servidor'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo conectar/)
    expect(ordersApi.getOrderDetail).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Anular ítem' })).toBeEnabled()
  })
})

describe('OrderDetailPage — tiempo real', () => {
  it('se suscribe a item:status_changed', async () => {
    renderPage()
    await screen.findByText('Producto i1')

    expect(useRealtimeEvent).toHaveBeenCalledWith('item:status_changed', expect.any(Function))
  })

  it('refleja la anulación hecha desde otro dispositivo sin recargar', async () => {
    renderPage({ user: WAITER, items: [makeItem('i1', 'pendiente', { quantity: 1, unitPrice: 10000 })] })
    await screen.findByText('Producto i1')

    const handler = useRealtimeEvent.mock.calls.at(-1)[1]
    handler({
      ...makeItem('i1', 'cancelado', { cancelledReason: 'Anulado en caja', cancelledBy: 'otro' }),
      orderId: ORDER_ID,
    })

    expect(await screen.findByText('Cancelado', { selector: '.od-pill' })).toBeInTheDocument()
    expect(screen.getByText(/Anulado en caja/)).toBeInTheDocument()
    expect(ordersApi.getOrderDetail).toHaveBeenCalledTimes(1)
  })

  it('ignora los eventos de otra orden', async () => {
    renderPage({ user: WAITER, items: [makeItem('i1', 'pendiente')] })
    await screen.findByText('Producto i1')

    const handler = useRealtimeEvent.mock.calls.at(-1)[1]
    handler({ ...makeItem('i1', 'cancelado'), orderId: 'otra-orden' })

    expect(screen.queryByText('Cancelado', { selector: '.od-pill' })).toBeNull()
  })
})
