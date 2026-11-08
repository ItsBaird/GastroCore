import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
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

function makeOrder(items, status = 'ABIERTA') {
  return {
    orderId: ORDER_ID,
    tableId: 'table-1',
    tableNumber: 2,
    waiterId: WAITER.userId,
    status,
    openedAt: new Date().toISOString(),
    closedAt: null,
    discountAmount: 0,
    rounds: [{ roundId: 'round-1', orderId: ORDER_ID, source: 'WAITER', items }],
  }
}

function renderPage({ user = WAITER, items = [makeItem('i1', 'pendiente')], status = 'ABIERTA' } = {}) {
  ordersApi.getOrderDetail.mockResolvedValue(makeOrder(items, status))
  const auth = { status: 'authenticated', user, login: vi.fn(), logout: vi.fn() }
  return render(
    <MemoryRouter initialEntries={[`/mesero/mesas/${ORDER_ID}`]}>
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <Routes>
            <Route path="/mesero/mesas/:orderId" element={<OrderDetailPage />} />
            <Route path="/mesero/mesas/:orderId/cobro" element={<CobroProbe />} />
          </Routes>
        </ToastProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

// Destino de Solicitar Cobro: muestra la cuenta que llega por el estado de la navegacion
function CobroProbe() {
  const { state } = useLocation()
  return <p>Pantalla de cobro, total {state?.bill?.total}</p>
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

    expect(useRealtimeEvent).toHaveBeenCalledWith('item:status_changed', expect.any(Function), {
      onReconnect: expect.any(Function),
    })
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

const entregarIn = (name) => within(rowOf(name)).queryByRole('button', { name: /entregar/i })

describe('OrderDetailPage — entregar ítems listos (GC-ORD-0005)', () => {
  const STATES = ['pendiente', 'en_preparacion', 'listo', 'entregado', 'cancelado']

  it('"Entregar" aparece solo en los ítems listos', async () => {
    renderPage({ user: WAITER, items: STATES.map((s, i) => makeItem(`i${i}`, s)) })
    await screen.findByText('Producto i0')

    expect(entregarIn('Producto i0')).toBeNull()
    expect(entregarIn('Producto i1')).toBeNull()
    expect(entregarIn('Producto i2')).toBeInTheDocument()
    expect(entregarIn('Producto i3')).toBeNull()
    expect(entregarIn('Producto i4')).toBeNull()
    expect(screen.getByText('Listo', { selector: '.od-pill' })).toHaveClass('od-pill--listo')
  })

  it('el ADMIN ve Entregar y Anular en un ítem listo', async () => {
    renderPage({ user: ADMIN, items: [makeItem('i1', 'listo')] })
    await screen.findByText('Producto i1')

    expect(entregarIn('Producto i1')).toBeInTheDocument()
    expect(anularIn('Producto i1')).toBeInTheDocument()
  })

  it('con la mesa en cobro se puede entregar pero no anular ni agregar ítems', async () => {
    renderPage({ user: ADMIN, items: [makeItem('i1', 'listo')], status: 'EN_COBRO' })
    await screen.findByText('Producto i1')

    expect(entregarIn('Producto i1')).toBeInTheDocument()
    expect(anularIn('Producto i1')).toBeNull()
    expect(screen.getByRole('button', { name: /Agregar Ítem/ })).toBeDisabled()
    expect(screen.getByText('En Cobro')).toHaveClass('od-status-badge--en-cobro')
  })

  it('se deshabilita mientras la petición está en curso y sin actualización optimista', async () => {
    const user = userEvent.setup()
    renderPage({ user: WAITER, items: [makeItem('i1', 'listo')] })
    await screen.findByText('Producto i1')
    let resolve
    ordersApi.deliverItem.mockImplementation(() => new Promise((r) => (resolve = r)))

    await user.click(entregarIn('Producto i1'))

    const button = entregarIn('Producto i1')
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Entregando…')
    expect(screen.getByText('Listo', { selector: '.od-pill' })).toBeInTheDocument()

    resolve(makeItem('i1', 'entregado', { deliveredAt: '2026-11-07T18:00:00Z' }))
    expect(await screen.findByText('Entregado', { selector: '.od-pill' })).toBeInTheDocument()
  })

  it('al entregar pasa a "Entregado", deja de resaltarse y no envía datos (R4)', async () => {
    const user = userEvent.setup()
    renderPage({ user: WAITER, items: [makeItem('i1', 'listo')] })
    await screen.findByText('Producto i1')
    ordersApi.deliverItem.mockResolvedValue(makeItem('i1', 'entregado', { deliveredAt: '2026-11-07T18:00:00Z' }))

    await user.click(entregarIn('Producto i1'))

    expect(ordersApi.deliverItem).toHaveBeenCalledWith('i1')
    expect(await screen.findByText('Entregado', { selector: '.od-pill' })).toBeInTheDocument()
    expect(entregarIn('Producto i1')).toBeNull()
    expect(await screen.findByText(/Producto i1 entregado/)).toBeInTheDocument()
  })

  it.each([
    [409, 'INVALID_TRANSITION', 'Solo se entregan ítems listos; este está cancelado', 2],
    [404, 'NOT_FOUND', 'El ítem no existe', 2],
    [403, 'FORBIDDEN', 'No tienes asignada esta mesa', 2],
  ])('%s avisa con mensaje claro y refresca el detalle', async (status, code, message, loads) => {
    const user = userEvent.setup()
    renderPage({ user: WAITER, items: [makeItem('i1', 'listo')] })
    await screen.findByText('Producto i1')
    ordersApi.deliverItem.mockRejectedValue(new ApiError(status, code, message))

    await user.click(entregarIn('Producto i1'))

    const toast = await screen.findByText(status === 404 ? /ya no existe/ : message, { selector: '.toast--error' })
    expect(toast).toHaveAttribute('role', 'status')
    expect(ordersApi.getOrderDetail).toHaveBeenCalledTimes(loads)
  })

  it('un error de red avisa, no recarga y deja reintentar', async () => {
    const user = userEvent.setup()
    renderPage({ user: WAITER, items: [makeItem('i1', 'listo')] })
    await screen.findByText('Producto i1')
    ordersApi.deliverItem.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'No se pudo conectar'))

    await user.click(entregarIn('Producto i1'))

    expect(await screen.findByText(/Sin conexión/, { selector: '.toast--error' })).toBeInTheDocument()
    expect(ordersApi.getOrderDetail).toHaveBeenCalledTimes(1)
    expect(entregarIn('Producto i1')).toBeEnabled()
  })

  it('cocina marca listo: el ítem se resalta en vivo con su botón', async () => {
    renderPage({ user: WAITER, items: [makeItem('i1', 'en_preparacion')] })
    await screen.findByText('Producto i1')
    expect(entregarIn('Producto i1')).toBeNull()

    const handler = useRealtimeEvent.mock.calls.at(-1)[1]
    act(() => handler({ ...makeItem('i1', 'listo'), orderId: ORDER_ID, tableNumber: 2 }))

    expect(await screen.findByText('Listo', { selector: '.od-pill' })).toBeInTheDocument()
    expect(entregarIn('Producto i1')).toBeInTheDocument()
  })

  it('otro dispositivo lo entrega: deja de resaltarse en vivo', async () => {
    renderPage({ user: WAITER, items: [makeItem('i1', 'listo')] })
    await screen.findByText('Producto i1')

    const handler = useRealtimeEvent.mock.calls.at(-1)[1]
    act(() => handler({ ...makeItem('i1', 'entregado'), orderId: ORDER_ID, tableNumber: 2 }))

    expect(await screen.findByText('Entregado', { selector: '.od-pill' })).toBeInTheDocument()
    expect(entregarIn('Producto i1')).toBeNull()
  })

  it('al reconectar el socket recarga el detalle sin vaciar la pantalla', async () => {
    renderPage({ user: WAITER, items: [makeItem('i1', 'listo')] })
    await screen.findByText('Producto i1')
    ordersApi.getOrderDetail.mockResolvedValue(makeOrder([makeItem('i1', 'entregado')]))

    const { onReconnect } = useRealtimeEvent.mock.calls.at(-1)[2]
    act(() => onReconnect())

    expect(screen.queryByText('Cargando detalle…')).toBeNull()
    expect(await screen.findByText('Entregado', { selector: '.od-pill' })).toBeInTheDocument()
    expect(ordersApi.getOrderDetail).toHaveBeenCalledTimes(2)
  })
})

describe('OrderDetailPage — Solicitar Cobro (GC-ORD-0006)', () => {
  const cobroButton = () => screen.getByRole('button', { name: /Solicitar Cobro|Ver Cobro|Generando/ })

  it('sin ítems entregados está deshabilitado con una pista', async () => {
    renderPage({ user: WAITER, items: [makeItem('i1', 'listo')] })
    await screen.findByText('Producto i1')

    expect(cobroButton()).toBeDisabled()
    expect(cobroButton()).toHaveAttribute('title', expect.stringMatching(/Entrega al menos un ítem/))
  })

  it('con un ítem entregado solicita el cobro (POST) y navega con la cuenta que devuelve', async () => {
    const user = userEvent.setup()
    renderPage({ user: WAITER, items: [makeItem('i1', 'entregado'), makeItem('i2', 'pendiente')] })
    await screen.findByText('Producto i1')
    ordersApi.startBilling.mockResolvedValue({ orderId: ORDER_ID, tableNumber: 2, total: 20000 })

    await user.click(cobroButton())

    expect(ordersApi.startBilling).toHaveBeenCalledWith(ORDER_ID)
    expect(await screen.findByText('Pantalla de cobro, total 20000')).toBeInTheDocument()
  })

  it('mientras la pide queda deshabilitado', async () => {
    const user = userEvent.setup()
    renderPage({ user: WAITER, items: [makeItem('i1', 'entregado')] })
    await screen.findByText('Producto i1')
    ordersApi.startBilling.mockImplementation(() => new Promise(() => {}))

    await user.click(cobroButton())

    expect(cobroButton()).toBeDisabled()
    expect(cobroButton()).toHaveTextContent('Generando cuenta…')
  })

  it.each([
    [409, 'NO_DELIVERED_ITEMS', 'Para generar la cuenta debe haber al menos un ítem entregado', 2],
    [403, 'FORBIDDEN', 'No tienes asignada esta mesa', 2],
    [0, 'NETWORK_ERROR', 'Sin conexión: no se generó la cuenta. Intenta de nuevo.', 1],
  ])('%s %s: avisa y no navega', async (status, code, message, loads) => {
    const user = userEvent.setup()
    renderPage({ user: WAITER, items: [makeItem('i1', 'entregado')] })
    await screen.findByText('Producto i1')
    ordersApi.startBilling.mockRejectedValue(new ApiError(status, code, 'mensaje del servidor'))

    await user.click(cobroButton())

    const expected = status === 0 ? message : 'mensaje del servidor'
    expect(await screen.findByText(expected, { selector: '.toast--error' })).toBeInTheDocument()
    expect(screen.queryByText(/Pantalla de cobro/)).toBeNull()
    expect(ordersApi.getOrderDetail).toHaveBeenCalledTimes(loads)
    expect(cobroButton()).toBeEnabled()
  })

  it('con la mesa ya en cobro el botón dice "Ver Cobro" y solo navega, sin solicitar otra vez', async () => {
    const user = userEvent.setup()
    renderPage({ user: WAITER, items: [makeItem('i1', 'entregado')], status: 'EN_COBRO' })
    await screen.findByText('Producto i1')

    await user.click(screen.getByRole('button', { name: 'Ver Cobro' }))

    expect(await screen.findByText(/Pantalla de cobro/)).toBeInTheDocument()
    expect(ordersApi.startBilling).not.toHaveBeenCalled()
    expect(ordersApi.getBill).not.toHaveBeenCalled()
  })

  it('el resumen marca las filas que tablet y móvil ocultan (37:51, 41:45)', async () => {
    renderPage({ user: WAITER, items: [makeItem('i1', 'entregado')] })
    await screen.findByText('Producto i1')

    expect(screen.getByText('Mesa:').closest('.od-summary__row')).toHaveClass('od-summary__row--desktop')
    expect(screen.getByText('En preparación:').closest('.od-summary__row')).toHaveClass('od-summary__row--desktop')
    expect(screen.getByText('Subtotal:').closest('.od-summary__row')).toHaveClass('od-summary__row--desktop')
    expect(screen.getByText('Pendientes:').closest('.od-summary__row')).toHaveClass('od-summary__row--no-mobile')
    expect(cobroButton().closest('.od-summary__actions')).toBeInTheDocument()
  })
})
