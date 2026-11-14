import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/errors.js'
import * as menuApi from '../api/menu.js'
import * as qrApi from '../api/qrRequests.js'
import * as tablesApi from '../api/tablesStatus.js'
import { AuthContext } from '../auth/authContext.js'
import { ToastProvider } from '../components/Toast.jsx'
import { WaiterInboxProvider } from '../hooks/useWaiterInbox.jsx'
import CallsInboxPage from './CallsInboxPage.jsx'

vi.mock('../api/qrRequests.js')
vi.mock('../api/tablesStatus.js')
vi.mock('../api/menu.js')
vi.mock('../hooks/useActiveShift.js', () => ({ useActiveShift: vi.fn() }))
vi.mock('../hooks/useRealtimeEvent.js', () => ({ useRealtimeEvents: vi.fn(), useRealtimeEvent: vi.fn() }))

const { useRealtimeEvents } = await import('../hooks/useRealtimeEvent.js')

const ME = 'waiter-1'
const WAITER = { userId: ME, email: 'mesero@lapizzeta.com', role: 'WAITER' }
const ADMIN = { userId: 'admin-1', email: 'admin@lapizzeta.com', role: 'ADMIN' }

const MENU = [
  {
    categoryId: 'c1',
    name: 'Pizzas',
    products: [
      { productId: 'p1', name: 'Pizzeta Pepperoni', price: 35000 },
      { productId: 'p2', name: 'Agua', price: 2000 },
    ],
  },
]

const REQ_OLD = {
  qrRequestId: 'q-old',
  orderId: 'o-7',
  tableNumber: 7,
  status: 'pendiente',
  createdAt: '2026-11-13T10:00:00Z',
  items: [
    { productId: 'p1', quantity: 2, note: '<img src=x onerror=alert(1)>' },
    { productId: 'p-gone', quantity: 1 },
  ],
}
const REQ_NEW = {
  qrRequestId: 'q-new',
  orderId: 'o-9',
  tableNumber: 9,
  status: 'pendiente',
  createdAt: '2026-11-13T10:05:00Z',
  items: [{ productId: 'p2', quantity: 1 }],
}

const call = (id, type = 'call_waiter') => ({ serviceCallId: id, type, status: 'pendiente', createdAt: '2026-11-13T10:01:00Z' })
const TABLES = [
  { tableId: 't-free', tableNumber: 3, status: 'libre', pendingCalls: [call('c-free')] },
  { tableId: 't-mine', tableNumber: 7, status: 'ocupada', orderId: 'o-7', waiterId: ME, pendingCalls: [call('c-mine', 'request_bill')] },
  { tableId: 't-other', tableNumber: 8, status: 'ocupada', orderId: 'o-8', waiterId: 'waiter-2', pendingCalls: [call('c-other')] },
]

function renderInbox(user = WAITER) {
  const auth = { status: 'authenticated', user, login: vi.fn(), logout: vi.fn() }
  return render(
    <MemoryRouter initialEntries={['/mesero/llamados']}>
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <WaiterInboxProvider>
            <Routes>
              <Route path="/mesero/llamados" element={<CallsInboxPage />} />
              <Route path="/mesero/mesas/:orderId" element={<p>Detalle de la mesa</p>} />
            </Routes>
          </WaiterInboxProvider>
        </ToastProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

const handlers = () => useRealtimeEvents.mock.calls.at(-1)[0]
const options = () => useRealtimeEvents.mock.calls.at(-1)[1]
const requestsSection = () => within(screen.getByRole('region', { name: /Solicitudes de pedido/ }))
const callsSection = () => within(screen.getByRole('region', { name: /^Llamados/ }))

beforeEach(() => {
  vi.resetAllMocks()
  menuApi.getMenu.mockResolvedValue(MENU)
  qrApi.listPendingQrRequests.mockResolvedValue([REQ_NEW, REQ_OLD])
  tablesApi.listTableStatuses.mockResolvedValue(TABLES)
})

describe('CallsInboxPage: bandeja de solicitudes QR', () => {
  it('lista las solicitudes de la más antigua a la más nueva, con nombres del menú y la nota como texto', async () => {
    renderInbox()

    expect(await requestsSection().findByText('Pizzeta Pepperoni')).toBeInTheDocument()
    const cards = requestsSection().getAllByRole('listitem').filter((li) => li.classList.contains('inbox-card'))
    expect(within(cards[0]).getByText('Mesa 7')).toBeInTheDocument()
    expect(within(cards[1]).getByText('Mesa 9')).toBeInTheDocument()
    expect(within(cards[0]).getByText('Nota: <img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(document.querySelector('img[src="x"]')).toBeNull()
    expect(within(cards[0]).getByText('Producto no disponible')).toBeInTheDocument()
    expect(within(cards[0]).getByRole('link', { name: /Ajustar/ })).toHaveAttribute(
      'href',
      '/mesero/solicitudes/q-old/ajustar',
    )
  })

  it('confirmar tal cual: sin cuerpo, la quita de la bandeja y avisa', async () => {
    qrApi.confirmQrRequest.mockResolvedValue({ round: { roundId: 'r1' } })
    const user = userEvent.setup()
    renderInbox()
    await requestsSection().findByText('Mesa 7')

    await user.click(requestsSection().getAllByRole('button', { name: /Confirmar/ })[0])

    expect(qrApi.confirmQrRequest).toHaveBeenCalledWith('q-old')
    expect(await screen.findByText('Mesa 7: pedido confirmado y enviado a cocina')).toBeInTheDocument()
    expect(requestsSection().queryByText('Mesa 7')).toBeNull()
  })

  it('sin doble envío: mientras confirma, los botones de la tarjeta quedan deshabilitados', async () => {
    let resolve
    qrApi.confirmQrRequest.mockReturnValue(new Promise((r) => (resolve = r)))
    const user = userEvent.setup()
    renderInbox()
    await requestsSection().findByText('Mesa 7')
    const confirm = requestsSection().getAllByRole('button', { name: /Confirmar/ })[0]

    await user.click(confirm)
    expect(confirm).toBeDisabled()
    await user.click(confirm)
    expect(qrApi.confirmQrRequest).toHaveBeenCalledTimes(1)
    await act(async () => resolve({ round: {} }))
  })

  it('409 (ya resuelta en otro dispositivo): avisa y recarga la bandeja', async () => {
    qrApi.confirmQrRequest.mockRejectedValue(new ApiError(409, 'INVALID_TRANSITION', 'La solicitud ya fue resuelta'))
    const user = userEvent.setup()
    renderInbox()
    await requestsSection().findByText('Mesa 7')

    await user.click(requestsSection().getAllByRole('button', { name: /Confirmar/ })[0])

    expect(await screen.findByText('La solicitud ya fue resuelta')).toBeInTheDocument()
    await waitFor(() => expect(qrApi.listPendingQrRequests).toHaveBeenCalledTimes(2))
  })

  it('403 (la mesa se reasignó): mensaje claro y recarga', async () => {
    qrApi.confirmQrRequest.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'No tienes asignada esta mesa'))
    const user = userEvent.setup()
    renderInbox()
    await requestsSection().findByText('Mesa 7')

    await user.click(requestsSection().getAllByRole('button', { name: /Confirmar/ })[0])

    expect(await screen.findByText('Esta mesa ya no está asignada a ti.')).toBeInTheDocument()
    await waitFor(() => expect(qrApi.listPendingQrRequests).toHaveBeenCalledTimes(2))
  })

  it('rechazar pide confirmación y la quita', async () => {
    qrApi.rejectQrRequest.mockResolvedValue({ status: 'rechazada' })
    const user = userEvent.setup()
    renderInbox()
    await requestsSection().findByText('Mesa 7')

    await user.click(requestsSection().getAllByRole('button', { name: /Rechazar/ })[0])
    const dialog = screen.getByRole('dialog', { name: 'Rechazar solicitud' })
    await user.click(within(dialog).getByRole('button', { name: 'Sí, rechazar' }))

    expect(qrApi.rejectQrRequest).toHaveBeenCalledWith('q-old')
    expect(await screen.findByText('Mesa 7: solicitud rechazada')).toBeInTheDocument()
    expect(requestsSection().queryByText('Mesa 7')).toBeNull()
  })

  it('en vivo: qr_request:created agrega la solicitud una sola vez y avisa', async () => {
    qrApi.listPendingQrRequests.mockResolvedValue([])
    renderInbox()
    await requestsSection().findByText('No hay solicitudes de pedido pendientes.')

    act(() => handlers()['qr_request:created'](REQ_NEW))
    act(() => handlers()['qr_request:created'](REQ_NEW))

    expect(await screen.findByText('Mesa 9 envió un pedido')).toBeInTheDocument()
    expect(requestsSection().getAllByText('Mesa 9')).toHaveLength(1)
  })

  it('al cobrar la mesa (order:updated CERRADA o mesa libre) sus solicitudes desaparecen', async () => {
    renderInbox()
    await requestsSection().findByText('Mesa 7')

    act(() => handlers()['order:updated']({ orderId: 'o-7', status: 'CERRADA' }))
    expect(requestsSection().queryByText('Mesa 7')).toBeNull()

    act(() => handlers()['table:status_changed']({ tableId: 't-9', tableNumber: 9, status: 'libre', pendingCalls: [] }))
    expect(requestsSection().queryByText('Mesa 9')).toBeNull()
  })

  it('al reconectar recarga la bandeja', async () => {
    renderInbox()
    await requestsSection().findByText('Mesa 7')

    await act(() => options().onReconnect())

    expect(qrApi.listPendingQrRequests).toHaveBeenCalledTimes(2)
    expect(tablesApi.listTableStatuses).toHaveBeenCalledTimes(2)
  })
})

describe('CallsInboxPage: llamados', () => {
  it('el mesero ve los de sus mesas y los de mesas libres, no los de otro mesero', async () => {
    renderInbox()

    expect(await callsSection().findByText('Mesa 3 · Llama al mesero')).toBeInTheDocument()
    expect(callsSection().getByText('Mesa 7 · Pide la cuenta')).toBeInTheDocument()
    expect(callsSection().queryByText(/Mesa 8/)).toBeNull()
  })

  it('el ADMIN ve todos', async () => {
    renderInbox(ADMIN)
    expect(await callsSection().findByText('Mesa 8 · Llama al mesero')).toBeInTheDocument()
  })

  it('en vivo: waiter:called agrega el llamado y avisa', async () => {
    renderInbox()
    await callsSection().findByText('Mesa 3 · Llama al mesero')

    act(() => handlers()['waiter:called']({ ...call('c-new'), tableId: 't-mine', tableNumber: 7 }))

    expect(await screen.findByText('Mesa 7 te llama')).toBeInTheDocument()
    expect(callsSection().getByText('Mesa 7 · Llama al mesero')).toBeInTheDocument()
  })

  it('table:status_changed reemplaza los llamados de esa mesa (al abrirla quedan atendidos)', async () => {
    renderInbox()
    await callsSection().findByText('Mesa 3 · Llama al mesero')

    act(() =>
      handlers()['table:status_changed']({ tableId: 't-free', tableNumber: 3, status: 'ocupada', waiterId: ME, orderId: 'o-3', pendingCalls: [] }),
    )

    expect(callsSection().queryByText('Mesa 3 · Llama al mesero')).toBeNull()
  })

  it('mesa libre: "Abrir mesa" la abre y lleva a su detalle; mesa ocupada: "Ir a la mesa"', async () => {
    tablesApi.openTable.mockResolvedValue({ orderId: 'o-3' })
    const user = userEvent.setup()
    renderInbox()
    await callsSection().findByText('Mesa 3 · Llama al mesero')
    expect(callsSection().getByRole('link', { name: 'Ir a la mesa' })).toHaveAttribute('href', '/mesero/mesas/o-7')

    await user.click(callsSection().getByRole('button', { name: /Abrir mesa/ }))

    expect(tablesApi.openTable).toHaveBeenCalledWith('t-free')
    expect(await screen.findByText('Detalle de la mesa')).toBeInTheDocument()
  })

  it('sin llamados ni solicitudes: estados vacíos', async () => {
    qrApi.listPendingQrRequests.mockResolvedValue([])
    tablesApi.listTableStatuses.mockResolvedValue([])
    renderInbox()

    expect(await screen.findByText('No hay solicitudes de pedido pendientes.')).toBeInTheDocument()
    expect(screen.getByText('No hay llamados pendientes.')).toBeInTheDocument()
  })
})
