import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/errors.js'
import * as ordersApi from '../api/orders.js'
import * as paymentApi from '../api/paymentMethods.js'
import * as qrApi from '../api/qrRequests.js'
import { AuthContext } from '../auth/authContext.js'
import { ToastProvider } from '../components/Toast.jsx'
import BillPage from './BillPage.jsx'

vi.mock('../api/orders.js')
vi.mock('../api/paymentMethods.js')
vi.mock('../api/qrRequests.js')
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

function renderPage({ state, user = WAITER } = {}) {
  const auth = { status: 'authenticated', user, login: vi.fn(), logout: vi.fn() }
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
  qrApi.listPendingQrRequests.mockResolvedValue([])
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

  it('la cuenta de la navegación se ve al instante y se refresca con el GET (puede estar vieja tras recargar)', async () => {
    ordersApi.getBill.mockResolvedValue({ ...BILL, discountAmount: 1, total: 76000 })
    renderPage({ state: { bill: BILL } })

    expect(screen.getByText('Pizzeta Pepperoni')).toBeInTheDocument()
    expect(ordersApi.getBill).toHaveBeenCalledWith(ORDER_ID)
    expect(await screen.findByText('Confirmar Pago — $76.000')).toBeInTheDocument()
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
      useRealtimeEvent.mock.calls.findLast((c) => c[0] === 'table:status_changed')[1]({ tableNumber: 4, status: 'ocupada', orderId: ORDER_ID, pendingCalls: [] }),
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
  const handler = () => useRealtimeEvent.mock.calls.findLast((c) => c[0] === 'table:status_changed')[1]

  it('se suscribe a table:status_changed y recarga al reconectar', async () => {
    renderPage()
    await screen.findByText('Pizzeta Pepperoni')

    expect(useRealtimeEvent).toHaveBeenCalledWith('table:status_changed', expect.any(Function), {
      onReconnect: expect.any(Function),
    })
    await act(() => useRealtimeEvent.mock.calls.findLast((c) => c[0] === 'table:status_changed')[2].onReconnect())
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

describe('BillPage — descuento (GC-ORD-0007)', () => {
  const ADMIN = { userId: 'admin-1', email: 'admin@lapizzeta.com', role: 'ADMIN', permissions: [] }
  const WAITER_WITH = { ...WAITER, permissions: ['discount:apply'] }
  const discountButton = () => screen.queryByRole('button', { name: /descuento/i })
  const amountInput = () => screen.getByLabelText('Monto del descuento')
  const openModal = async (user, bill = BILL) => {
    ordersApi.getBill.mockResolvedValue(bill)
    const ui = userEvent.setup()
    renderPage({ user })
    await ui.click(await screen.findByRole('button', { name: /descuento/i }))
    return ui
  }

  it('un mesero sin discount:apply no ve el botón', async () => {
    renderPage({ user: { ...WAITER, permissions: [] } })
    await screen.findByText('Pizzeta Pepperoni')

    expect(discountButton()).toBeNull()
  })

  it('lo ven el ADMIN y el mesero con discount:apply', async () => {
    const { unmount } = renderPage({ user: ADMIN })
    expect(await screen.findByRole('button', { name: 'Aplicar descuento' })).toBeInTheDocument()
    unmount()

    renderPage({ user: WAITER_WITH })
    expect(await screen.findByRole('button', { name: 'Aplicar descuento' })).toBeInTheDocument()
  })

  it('solo acepta dígitos y envía solo el monto (R4); muestra lo que devuelve el backend', async () => {
    const ui = await openModal(ADMIN)
    ordersApi.applyDiscount.mockResolvedValue({ ...BILL, discountAmount: 15000, total: 61001 })

    await ui.type(amountInput(), '$15.000')
    expect(amountInput()).toHaveValue('15000')
    await ui.click(screen.getByRole('button', { name: 'Aplicar' }))

    expect(ordersApi.applyDiscount).toHaveBeenCalledWith(ORDER_ID, { discountAmount: 15000 })
    expect(await screen.findByText('−$15.000')).toBeInTheDocument()
    expect(screen.getByText('Confirmar Pago — $61.001')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await screen.findByText(/Descuento de \$15\.000 aplicado/)).toBeInTheDocument()
  })

  it('envía el motivo recortado si lo hay', async () => {
    const ui = await openModal(ADMIN)
    ordersApi.applyDiscount.mockResolvedValue({ ...BILL, discountAmount: 1000, total: 75001 })

    await ui.type(amountInput(), '1000')
    await ui.type(screen.getByLabelText('Motivo (opcional)'), '  Cliente frecuente  ')
    await ui.click(screen.getByRole('button', { name: 'Aplicar' }))

    expect(ordersApi.applyDiscount).toHaveBeenCalledWith(ORDER_ID, {
      discountAmount: 1000,
      reason: 'Cliente frecuente',
    })
  })

  it('mayor que el subtotal: avisa en el campo sin enviar', async () => {
    const ui = await openModal(ADMIN)

    await ui.type(amountInput(), '80000')
    await ui.click(screen.getByRole('button', { name: 'Aplicar' }))

    expect(screen.getByText(/No puede superar el subtotal \(\$76\.001\)/)).toBeInTheDocument()
    expect(ordersApi.applyDiscount).not.toHaveBeenCalled()
  })

  it('un 400 del backend se muestra en el campo y el modal sigue abierto', async () => {
    const ui = await openModal(ADMIN)
    ordersApi.applyDiscount.mockRejectedValue(
      new ApiError(400, 'VALIDATION_ERROR', 'El descuento no puede superar el subtotal de la cuenta'),
    )

    await ui.type(amountInput(), '500')
    await ui.click(screen.getByRole('button', { name: 'Aplicar' }))

    expect(await screen.findByText(/no puede superar el subtotal de la cuenta/)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('deshabilitado mientras envía: sin doble envío', async () => {
    const ui = await openModal(ADMIN)
    ordersApi.applyDiscount.mockImplementation(() => new Promise(() => {}))

    await ui.type(amountInput(), '500')
    await ui.click(screen.getByRole('button', { name: 'Aplicar' }))

    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeDisabled()
    await ui.click(screen.getByRole('button', { name: 'Aplicar' }))
    expect(ordersApi.applyDiscount).toHaveBeenCalledTimes(1)
  })

  it.each([
    [409, 'INVALID_TRANSITION', 'Solo se puede aplicar un descuento a una mesa en cobro'],
    [403, 'FORBIDDEN', 'No tienes permiso para aplicar descuentos'],
    [404, 'NOT_FOUND', 'La orden no existe'],
  ])('%s: cierra, avisa y vuelve a pedir la cuenta', async (status, code, message) => {
    const ui = await openModal(ADMIN)
    ordersApi.applyDiscount.mockRejectedValue(new ApiError(status, code, message))

    await ui.type(amountInput(), '500')
    await ui.click(screen.getByRole('button', { name: 'Aplicar' }))

    expect(await screen.findByText(message, { selector: '.toast--error' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ordersApi.getBill).toHaveBeenCalledTimes(2)
  })

  it('sin conexión: avisa dentro del modal y deja reintentar', async () => {
    const ui = await openModal(ADMIN)
    ordersApi.applyDiscount.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'x'))

    await ui.type(amountInput(), '500')
    await ui.click(screen.getByRole('button', { name: 'Aplicar' }))

    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
      /Sin conexión/,
    )
    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeEnabled()
  })

  it('con descuento vigente: "Cambiar descuento", monto precargado y "Quitar descuento" envía 0', async () => {
    const withDiscount = { ...BILL, discountAmount: 5000, total: 71001 }
    const ui = await openModal(ADMIN, withDiscount)
    ordersApi.applyDiscount.mockResolvedValue({ ...BILL })

    expect(screen.getByRole('dialog')).toHaveTextContent('Cambiar descuento')
    expect(amountInput()).toHaveValue('5000')
    await ui.click(screen.getByRole('button', { name: 'Quitar descuento' }))

    expect(ordersApi.applyDiscount).toHaveBeenCalledWith(ORDER_ID, { discountAmount: 0 })
    expect(await screen.findByText('Descuento quitado')).toBeInTheDocument()
    expect(screen.queryByText('Descuento:')).toBeNull()
  })

  it('order:updated de esta orden vuelve a pedir la cuenta; de otra orden se ignora', async () => {
    renderPage()
    await screen.findByText('Pizzeta Pepperoni')
    const handler = useRealtimeEvent.mock.calls.findLast((c) => c[0] === 'order:updated')[1]
    ordersApi.getBill.mockResolvedValue({ ...BILL, discountAmount: 1, total: 76000 })

    await act(async () =>
      handler({ orderId: 'otra', tableNumber: 9, status: 'EN_COBRO', discountAmount: 1 }),
    )
    expect(ordersApi.getBill).toHaveBeenCalledTimes(1)

    await act(async () =>
      handler({ orderId: ORDER_ID, tableNumber: 4, status: 'EN_COBRO', discountAmount: 1 }),
    )
    expect(await screen.findByText('Confirmar Pago — $76.000')).toBeInTheDocument()
  })
})

// GC-ORD-0008. Zona de pago: metodo, monto recibido, cambio estimado y Confirmar Pago
describe('BillPage — pago', () => {
  const PAYMENT = {
    paymentId: 'p1',
    orderId: ORDER_ID,
    paymentMethodId: 'm1',
    subtotal: 76001,
    discountAmount: 0,
    total: 76001,
    amountReceived: 80000,
    changeGiven: 3999,
    registeredBy: 'user-1',
    paidAt: '2026-11-10T20:00:00Z',
  }

  async function ready() {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('radio', { name: 'Efectivo' })
    return user
  }

  const payButton = () => screen.getByRole('button', { name: 'Confirmar Pago — $76.001' })

  it('lista los métodos activos sin elegir ninguno: sin campo de monto y Confirmar Pago deshabilitado', async () => {
    await ready()

    expect(paymentApi.listPaymentMethods).toHaveBeenCalledWith({ active: true })
    expect(screen.queryByText('Próximamente')).toBeNull()
    expect(screen.getByRole('radio', { name: 'Efectivo' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('radio', { name: 'Nequi' })).toBeEnabled()
    expect(screen.queryByLabelText(/Monto recibido/)).toBeNull()
    expect(payButton()).toBeDisabled()
  })

  it('efectivo: muestra el campo, solo admite enteros con formato COP y estima el cambio con el total del backend', async () => {
    const user = await ready()
    await user.click(screen.getByRole('radio', { name: 'Efectivo' }))

    const radio = screen.getByRole('radio', { name: 'Efectivo' })
    expect(radio).toHaveAttribute('aria-checked', 'true')
    expect(radio).toHaveClass('bill-method--selected')
    const input = screen.getByLabelText(/Monto recibido/)
    expect(input).toHaveAttribute('inputmode', 'numeric')

    await user.type(input, '8a0.000,5')
    expect(input).toHaveValue('800.005')
    await user.clear(input)
    await user.type(input, '80000')
    expect(input).toHaveValue('80.000')
    // 80.000 - 76.001 (total del backend)
    expect(screen.getByText('$3.999')).toBeInTheDocument()
    expect(payButton()).toBeEnabled()
  })

  it('efectivo insuficiente: avisa cuánto falta y no deja confirmar', async () => {
    const user = await ready()
    await user.click(screen.getByRole('radio', { name: 'Efectivo' }))
    await user.type(screen.getByLabelText(/Monto recibido/), '76000')

    expect(screen.getByRole('alert')).toHaveTextContent('Faltan $1 para el total.')
    expect(screen.getByLabelText(/Monto recibido/)).toHaveAttribute('aria-invalid', 'true')
    expect(payButton()).toBeDisabled()
  })

  it('sin efectivo: no hay campo de monto y se puede confirmar', async () => {
    const user = await ready()
    await user.click(screen.getByRole('radio', { name: 'Nequi' }))

    expect(screen.queryByLabelText(/Monto recibido/)).toBeNull()
    expect(payButton()).toBeEnabled()
  })

  it('Esc. 1: confirma, envía solo método y monto (R4) y muestra el cambio que calculó el backend', async () => {
    ordersApi.registerPayment.mockResolvedValue({ ...PAYMENT, changeGiven: 4000 })
    const user = await ready()
    await user.click(screen.getByRole('radio', { name: 'Efectivo' }))
    await user.type(screen.getByLabelText(/Monto recibido/), '80000')
    await user.click(payButton())

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent(
      'Mesa 4 · Efectivo · Total: $76.001 · Recibido: $80.000 · Cambio estimado: $3.999',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Registrar pago' }))

    expect(ordersApi.registerPayment).toHaveBeenCalledWith(ORDER_ID, {
      paymentMethodId: 'm1',
      amountReceived: 80000,
    })
    // El toast usa el changeGiven de la respuesta (4.000), no la estimacion de la pantalla (3.999)
    expect(await screen.findByText('Pago registrado · Cambio $4.000')).toBeInTheDocument()
    expect(screen.getByText('Panel de mesas')).toBeInTheDocument()
  })

  it('Esc. 2: sin efectivo no envía monto y avisa el total pagado y el método', async () => {
    ordersApi.registerPayment.mockResolvedValue({
      ...PAYMENT,
      paymentMethodId: 'm2',
      amountReceived: null,
      changeGiven: null,
    })
    const user = await ready()
    await user.click(screen.getByRole('radio', { name: 'Nequi' }))
    await user.click(payButton())
    await user.click(screen.getByRole('button', { name: 'Registrar pago' }))

    expect(ordersApi.registerPayment).toHaveBeenCalledWith(ORDER_ID, { paymentMethodId: 'm2' })
    expect(await screen.findByText('Pago registrado · $76.001 con Nequi')).toBeInTheDocument()
    expect(screen.getByText('Panel de mesas')).toBeInTheDocument()
  })

  it('Esc. 3: el backend rechaza el monto (total cambió): error en el campo con el total vigente y se refresca la cuenta', async () => {
    ordersApi.registerPayment.mockRejectedValue(
      new ApiError(400, 'INSUFFICIENT_AMOUNT', 'El monto recibido no alcanza para el total', {
        total: 81000,
        amountReceived: 80000,
      }),
    )
    const user = await ready()
    await user.click(screen.getByRole('radio', { name: 'Efectivo' }))
    await user.type(screen.getByLabelText(/Monto recibido/), '80000')
    await user.click(payButton())
    await user.click(screen.getByRole('button', { name: 'Registrar pago' }))

    expect(
      await screen.findByText('El monto no alcanza: el total vigente es $81.000.'),
    ).toBeInTheDocument()
    expect(ordersApi.getBill).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('Panel de mesas')).toBeNull()
  })

  it('sin doble envío: mientras se registra, el diálogo queda ocupado y se llama una sola vez', async () => {
    let resolve
    ordersApi.registerPayment.mockReturnValue(new Promise((r) => (resolve = r)))
    const user = await ready()
    await user.click(screen.getByRole('radio', { name: 'Nequi' }))
    await user.click(payButton())
    const confirm = screen.getByRole('button', { name: 'Registrar pago' })
    await user.click(confirm)

    expect(confirm).toBeDisabled()
    await user.click(confirm)
    expect(ordersApi.registerPayment).toHaveBeenCalledTimes(1)
    await act(async () => resolve({ ...PAYMENT, changeGiven: null }))
  })

  it.each([
    [
      'método inactivo',
      new ApiError(409, 'PAYMENT_METHOD_INACTIVE', 'El método de pago está inactivo'),
      'Ese método de pago se desactivó. Elige otro.',
    ],
    [
      'ítems sin entregar',
      new ApiError(409, 'INVALID_TRANSITION', 'Hay ítems sin entregar', {
        items: [{ itemId: 'b', productName: 'Agua', status: 'listo' }],
      }),
      'Hay ítems sin entregar: Agua. Entrégalos o anúlalos antes de cobrar.',
    ],
    [
      'sin conexión',
      new ApiError(0, 'NETWORK_ERROR', 'x'),
      'Sin conexión: no se confirmó el pago. Intenta de nuevo.',
    ],
    [
      'otro mesero (403)',
      new ApiError(403, 'FORBIDDEN', 'No tienes asignada esta mesa'),
      'No tienes asignada esta mesa',
    ],
  ])('%s: muestra el motivo y se queda en el cobro', async (_label, error, message) => {
    ordersApi.registerPayment.mockRejectedValue(error)
    const user = await ready()
    await user.click(screen.getByRole('radio', { name: 'Nequi' }))
    await user.click(payButton())
    await user.click(screen.getByRole('button', { name: 'Registrar pago' }))

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByText('Panel de mesas')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('método inactivo: vuelve a cargar los métodos', async () => {
    ordersApi.registerPayment.mockRejectedValue(
      new ApiError(409, 'PAYMENT_METHOD_INACTIVE', 'El método de pago está inactivo'),
    )
    const user = await ready()
    await user.click(screen.getByRole('radio', { name: 'Nequi' }))
    paymentApi.listPaymentMethods.mockResolvedValue([METHODS[0]])
    await user.click(payButton())
    await user.click(screen.getByRole('button', { name: 'Registrar pago' }))

    await screen.findByText('Ese método de pago se desactivó. Elige otro.')
    expect(paymentApi.listPaymentMethods).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('radio', { name: 'Nequi' })).toBeNull()
  })

  it('ya pagada (doble clic en otro lado o red lenta): avisa y vuelve al panel', async () => {
    ordersApi.registerPayment.mockRejectedValue(
      new ApiError(409, 'INVALID_TRANSITION', 'La orden ya fue pagada'),
    )
    const user = await ready()
    await user.click(screen.getByRole('radio', { name: 'Nequi' }))
    await user.click(payButton())
    await user.click(screen.getByRole('button', { name: 'Registrar pago' }))

    expect(await screen.findByText('Esta orden ya fue pagada')).toBeInTheDocument()
    expect(screen.getByText('Panel de mesas')).toBeInTheDocument()
  })

  it('sin métodos activos: lo dice y no deja cobrar', async () => {
    paymentApi.listPaymentMethods.mockResolvedValue([])
    renderPage()

    expect(
      await screen.findByText(
        'No hay métodos de pago activos. Pide al administrador que active uno.',
      ),
    ).toBeInTheDocument()
    expect(payButton()).toBeDisabled()
  })

  it('error al cargar los métodos: permite reintentar', async () => {
    paymentApi.listPaymentMethods.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'x'))
    paymentApi.listPaymentMethods.mockResolvedValue(METHODS)
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('No se pudieron cargar los métodos de pago.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Reintentar/ }))
    expect(await screen.findByRole('radio', { name: 'Efectivo' })).toBeInTheDocument()
  })

  it('GC-128: avisa las solicitudes QR pendientes de esta orden que se rechazarán al pagar', async () => {
    qrApi.listPendingQrRequests.mockResolvedValue([
      { qrRequestId: 'q1', orderId: ORDER_ID },
      { qrRequestId: 'q2', orderId: ORDER_ID },
      { qrRequestId: 'q3', orderId: 'otra-orden' },
    ])
    renderPage()

    expect(
      await screen.findByText(
        'Esta mesa tiene 2 solicitudes QR pendientes; se rechazarán al pagar.',
      ),
    ).toBeInTheDocument()
  })

  it('tiempo real: otro dispositivo cobró la orden (order:updated CERRADA) -> vuelve al panel', async () => {
    renderPage()
    await screen.findByText('Pizzeta Pepperoni')

    await act(() =>
      useRealtimeEvent.mock.calls.findLast((c) => c[0] === 'order:updated')[1]({
        orderId: ORDER_ID,
        tableNumber: 4,
        status: 'CERRADA',
        discountAmount: 0,
      }),
    )

    expect(await screen.findByText('La mesa ya se cerró')).toBeInTheDocument()
    expect(screen.getByText('Panel de mesas')).toBeInTheDocument()
  })

  it('tiempo real: el cierre desde otro dispositivo llega por los dos eventos y se avisa una sola vez', async () => {
    renderPage()
    await screen.findByText('Pizzeta Pepperoni')
    const libre = useRealtimeEvent.mock.calls.findLast((c) => c[0] === 'table:status_changed')[1]
    const cerrada = useRealtimeEvent.mock.calls.findLast((c) => c[0] === 'order:updated')[1]

    await act(async () => {
      libre({ tableNumber: 4, status: 'libre', pendingCalls: [] })
      cerrada({ orderId: ORDER_ID, tableNumber: 4, status: 'CERRADA', discountAmount: 0 })
    })

    expect(await screen.findByText('Panel de mesas')).toBeInTheDocument()
    expect(screen.getAllByText('La mesa ya se cerró')).toHaveLength(1)
  })

  it('tiempo real: un descuento en vivo cambia el total y se avisa', async () => {
    renderPage()
    await screen.findByText('Confirmar Pago — $76.001')
    ordersApi.getBill.mockResolvedValue({ ...BILL, discountAmount: 6001, total: 70000 })

    await act(() =>
      useRealtimeEvent.mock.calls.findLast((c) => c[0] === 'order:updated')[1]({
        orderId: ORDER_ID,
        tableNumber: 4,
        status: 'EN_COBRO',
        discountAmount: 6001,
      }),
    )

    expect(await screen.findByText('La cuenta cambió: nuevo total $70.000')).toBeInTheDocument()
    expect(screen.getByText('Confirmar Pago — $70.000')).toBeInTheDocument()
  })
})
