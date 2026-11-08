import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/errors.js'
import * as ordersApi from '../api/orders.js'
import * as paymentApi from '../api/paymentMethods.js'
import { AuthContext } from '../auth/authContext.js'
import { ToastProvider } from '../components/Toast.jsx'
import BillPage from './BillPage.jsx'

vi.mock('../api/orders.js')
vi.mock('../api/paymentMethods.js')
vi.mock('../hooks/useRealtimeEvent.js', () => ({ useRealtimeEvent: vi.fn() }))
vi.mock('../hooks/useActiveShift.js', () => ({ useActiveShift: vi.fn() }))

const { useRealtimeEvent } = await import('../hooks/useRealtimeEvent.js')

const ORDER_ID = 'order-1'
const WAITER = { userId: 'user-1', email: 'mesero@lapizzeta.com', role: 'WAITER', isActive: true }

function line(itemId, productName, unitPrice, quantity, lineTotal, status = 'entregado') {
  return { itemId, productName, unitPrice, quantity, lineTotal, status }
}

// Montos deliberadamente "imposibles" (lineTotal != unitPrice x quantity): la pantalla debe mostrar lo
// que manda el backend y nunca recalcular (R4).
const BILL = {
  orderId: ORDER_ID,
  tableNumber: 4,
  status: 'EN_COBRO',
  items: [line('a', 'Pizzeta Pepperoni', 35000, 2, 70000), line('b', 'Agua', 2000, 3, 6001, 'listo')],
  subtotal: 76001,
  discountAmount: 0,
  total: 76001,
}

const METHODS = [
  { paymentMethodId: 'm1', name: 'Efectivo', isCash: true, isActive: true },
  { paymentMethodId: 'm2', name: 'Nequi', isCash: false, isActive: true },
]

function renderPage({ state } = {}) {
  const auth = { status: 'authenticated', user: WAITER, login: vi.fn(), logout: vi.fn() }
  return render(
    <MemoryRouter initialEntries={[{ pathname: `/mesero/mesas/${ORDER_ID}/cobro`, state }]}>
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <Routes>
            <Route path="/mesero/mesas/:orderId/cobro" element={<BillPage />} />
            <Route path="/mesero/mesas/:orderId" element={<p>Detalle de la orden</p>} />
            <Route path="/mesero/mesas" element={<p>Panel de mesas</p>} />
          </Routes>
        </ToastProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  ordersApi.getBill.mockResolvedValue(BILL)
  paymentApi.listPaymentMethods.mockResolvedValue(METHODS)
})

describe('BillPage — cuenta', () => {
  it('pide la cuenta al backend y muestra cada línea tal como llega, sin recalcular (R4)', async () => {
    renderPage()

    expect(await screen.findByText('Pizzeta Pepperoni')).toBeInTheDocument()
    expect(ordersApi.getBill).toHaveBeenCalledWith(ORDER_ID)
    expect(screen.getByText('Cobro — Mesa 4')).toBeInTheDocument()
    expect(screen.getByText('En Cobro')).toHaveClass('bill-badge')

    const agua = screen.getByText('Agua').closest('tr')
    expect(within(agua).getByText('$2.000')).toBeInTheDocument()
    expect(within(agua).getByText('$6.001')).toBeInTheDocument()
    expect(within(agua).queryByText('$6.000')).toBeNull()
    expect(screen.getAllByText('$76.001').length).toBeGreaterThanOrEqual(2)
  })

  it('si la cuenta llega por la navegación no la vuelve a pedir', async () => {
    renderPage({ state: { bill: BILL } })

    expect(screen.getByText('Pizzeta Pepperoni')).toBeInTheDocument()
    expect(ordersApi.getBill).not.toHaveBeenCalled()
  })

  it('sin descuento no muestra la fila; con descuento la muestra con el total del backend', async () => {
    const { unmount } = renderPage()
    await screen.findByText('Pizzeta Pepperoni')
    expect(screen.queryByText('Descuento:')).toBeNull()
    unmount()

    ordersApi.getBill.mockResolvedValue({ ...BILL, discountAmount: 6001, total: 70000 })
    renderPage()

    expect(await screen.findByText('Descuento:')).toBeInTheDocument()
    expect(screen.getByText('−$6.001')).toBeInTheDocument()
    expect(screen.getByText('Confirmar Pago — $70.000')).toBeInTheDocument()
  })

  it('el pago queda dibujado pero deshabilitado y rotulado "Próximamente"', async () => {
    renderPage()
    await screen.findByText('Pizzeta Pepperoni')

    expect(screen.getByText('Próximamente')).toBeInTheDocument()
    expect(await screen.findByRole('radio', { name: 'Efectivo' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Nequi' })).toBeDisabled()
    expect(screen.getByLabelText(/Monto recibido/)).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Confirmar Pago — $76.001' })).toBeDisabled()
    expect(paymentApi.listPaymentMethods).toHaveBeenCalledWith({ active: true })
  })

  it('"Imprimir Recibo" abre la impresión del navegador', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Pizzeta Pepperoni')

    await user.click(screen.getByRole('button', { name: /Imprimir Recibo/ }))

    expect(print).toHaveBeenCalledOnce()
  })
})

describe('BillPage — cancelar cobro', () => {
  const openConfirm = async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Pizzeta Pepperoni')
    await user.click(screen.getByRole('button', { name: 'Cancelar Cobro' }))
    return user
  }

  it('pide confirmación antes de cancelar', async () => {
    await openConfirm()

    expect(screen.getByRole('dialog')).toHaveTextContent(/La mesa 4 vuelve a estar ocupada/)
    expect(ordersApi.cancelBill).not.toHaveBeenCalled()
  })

  it('al confirmar cancela, avisa y vuelve al detalle', async () => {
    const user = await openConfirm()
    ordersApi.cancelBill.mockResolvedValue({ orderId: ORDER_ID, status: 'ABIERTA' })

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, cancelar cobro' }))

    expect(ordersApi.cancelBill).toHaveBeenCalledWith(ORDER_ID)
    expect(await screen.findByText('Detalle de la orden')).toBeInTheDocument()
  })

  it('la propia cancelación no se anuncia como hecha desde otro dispositivo', async () => {
    const user = await openConfirm()
    let resolveCancel
    ordersApi.cancelBill.mockImplementation(() => new Promise((r) => (resolveCancel = r)))

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, cancelar cobro' }))
    // El evento de la propia cancelacion llega antes que la respuesta HTTP
    act(() =>
      useRealtimeEvent.mock.calls.at(-1)[1]({ tableNumber: 4, status: 'ocupada', orderId: ORDER_ID, pendingCalls: [] }),
    )
    await act(async () => resolveCancel({ orderId: ORDER_ID, status: 'ABIERTA' }))

    expect(await screen.findByText('Detalle de la orden')).toBeInTheDocument()
    expect(screen.queryByText(/desde otro dispositivo/)).toBeNull()
  })

  it('409 (ya no estaba en cobro): avisa y lleva al detalle con el estado real', async () => {
    const user = await openConfirm()
    ordersApi.cancelBill.mockRejectedValue(new ApiError(409, 'INVALID_TRANSITION', 'La mesa ya no está en cobro'))

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, cancelar cobro' }))

    expect(await screen.findByText('Detalle de la orden')).toBeInTheDocument()
  })

  it('sin conexión: avisa y se queda en la cuenta', async () => {
    const user = await openConfirm()
    ordersApi.cancelBill.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'x'))

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sí, cancelar cobro' }))

    expect(await screen.findByText(/no se canceló el cobro/, { selector: '.toast--error' })).toBeInTheDocument()
    expect(screen.getByText('Pizzeta Pepperoni')).toBeInTheDocument()
  })
})

describe('BillPage — estados y errores', () => {
  it('muestra la carga', () => {
    ordersApi.getBill.mockImplementation(() => new Promise(() => {}))
    renderPage()

    expect(screen.getByText('Cargando cuenta…')).toBeInTheDocument()
  })

  it('NO_DELIVERED_ITEMS: mensaje claro y vuelta al detalle', async () => {
    const user = userEvent.setup()
    ordersApi.getBill.mockRejectedValue(
      new ApiError(409, 'NO_DELIVERED_ITEMS', 'Para generar la cuenta debe haber al menos un ítem entregado'),
    )
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/al menos un ítem entregado/)
    await user.click(within(alert).getByRole('button', { name: /Volver al detalle/ }))
    expect(await screen.findByText('Detalle de la orden')).toBeInTheDocument()
  })

  it.each([
    [403, 'FORBIDDEN', /No tienes asignada esta mesa/],
    [404, 'NOT_FOUND', /La orden no existe/],
    [409, 'INVALID_TRANSITION', /La orden ya está cerrada/],
  ])('%s muestra el error sin cuenta', async (status, code, text) => {
    ordersApi.getBill.mockRejectedValue(new ApiError(status, code, 'La orden ya está cerrada'))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(text)
    expect(screen.queryByText('Confirmar Pago', { exact: false })).toBeNull()
  })

  it('sin conexión ofrece Reintentar y vuelve a pedir la cuenta', async () => {
    const user = userEvent.setup()
    ordersApi.getBill.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'x'))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(/Sin conexión/)
    await user.click(screen.getByRole('button', { name: /Reintentar/ }))

    expect(await screen.findByText('Pizzeta Pepperoni')).toBeInTheDocument()
    expect(ordersApi.getBill).toHaveBeenCalledTimes(2)
  })
})

describe('BillPage — tiempo real', () => {
  const handler = () => useRealtimeEvent.mock.calls.at(-1)[1]

  it('se suscribe a table:status_changed y recarga al reconectar', async () => {
    renderPage()
    await screen.findByText('Pizzeta Pepperoni')

    expect(useRealtimeEvent).toHaveBeenCalledWith('table:status_changed', expect.any(Function), {
      onReconnect: expect.any(Function),
    })
    await act(() => useRealtimeEvent.mock.calls.at(-1)[2].onReconnect())
    expect(ordersApi.getBill).toHaveBeenCalledTimes(2)
  })

  it('otro dispositivo canceló el cobro: vuelve al detalle', async () => {
    renderPage()
    await screen.findByText('Pizzeta Pepperoni')

    act(() => handler()({ tableNumber: 4, status: 'ocupada', orderId: ORDER_ID, pendingCalls: [] }))

    expect(await screen.findByText('Detalle de la orden')).toBeInTheDocument()
  })

  it('la mesa se cerró: vuelve al panel', async () => {
    renderPage()
    await screen.findByText('Pizzeta Pepperoni')

    act(() => handler()({ tableNumber: 4, status: 'libre', pendingCalls: [] }))

    expect(await screen.findByText('Panel de mesas')).toBeInTheDocument()
  })

  it('ignora los cambios de otras mesas', async () => {
    renderPage()
    await screen.findByText('Pizzeta Pepperoni')

    act(() => handler()({ tableNumber: 9, status: 'libre', pendingCalls: [] }))

    expect(screen.getByText('Pizzeta Pepperoni')).toBeInTheDocument()
  })
})

describe('BillPage — mesa todavía abierta', () => {
  it('GET /bill ya no la pasa a cobro: avisa y no ofrece cobrar ni cancelar', async () => {
    const user = userEvent.setup()
    ordersApi.getBill.mockResolvedValue({ ...BILL, status: 'ABIERTA' })
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/todavía no está en cobro/)
    expect(screen.queryByRole('button', { name: 'Cancelar Cobro' })).toBeNull()
    expect(screen.queryByText(/Confirmar Pago/)).toBeNull()
    await user.click(within(alert).getByRole('button', { name: /Volver al detalle/ }))
    expect(await screen.findByText('Detalle de la orden')).toBeInTheDocument()
  })
})
