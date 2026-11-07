import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/errors.js'
import * as tablesStatusApi from '../api/tablesStatus.js'
import { AuthContext } from '../auth/authContext.js'
import { ToastProvider } from '../components/Toast.jsx'
import { useActiveShift } from '../hooks/useActiveShift.js'
import WaiterTablesPanelPage from './WaiterTablesPanelPage.jsx'

vi.mock('../api/tablesStatus.js')
vi.mock('../hooks/useTableStatusSocket.js', () => ({
  useTableStatusSocket: vi.fn(),
}))
vi.mock('../hooks/useActiveShift.js', () => ({
  useActiveShift: vi.fn(),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => mockNavigate,
}))

const ME = { userId: 'user-1', email: 'mesero@lapizzeta.com', role: 'WAITER', isActive: true }

const TABLES = [
  { tableId: 't1', tableNumber: 1, status: 'libre', pendingCalls: [] },
  { tableId: 't2', tableNumber: 2, status: 'ocupada', orderId: 'o1', waiterId: 'user-1', pendingCalls: [], itemsCount: 3 },
  { tableId: 't3', tableNumber: 3, status: 'en_cobro', orderId: 'o2', waiterId: 'user-2', pendingCalls: [
    { serviceCallId: 'sc1', tableId: 't3', type: 'request_bill', status: 'pendiente', createdAt: '2026-01-01T00:00:00Z' },
  ] },
]

const MY_BILLING_TABLE = {
  tableId: 't3',
  tableNumber: 3,
  status: 'en_cobro',
  orderId: 'o2',
  waiterId: 'user-1',
  pendingCalls: [],
}

function renderPage(tables = TABLES, user = ME) {
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

beforeEach(() => {
  vi.resetAllMocks()
})

describe('WaiterTablesPanelPage', () => {
  it('renders tables with correct status colors and labels', async () => {
    renderPage()

    expect(await screen.findByText('Mesa 1')).toBeInTheDocument()
    expect(screen.getByText('Libre', { selector: '.pill' })).toBeInTheDocument()
    expect(screen.getByText('Mesa 2')).toBeInTheDocument()
    expect(screen.getByText('Ocupada', { selector: '.pill' })).toBeInTheDocument()
    expect(screen.getByText('Mesa 3')).toBeInTheDocument()
    expect(screen.getByText('En Cobro', { selector: '.pill' })).toBeInTheDocument()
  })

  it('shows stat cards with correct counts', async () => {
    renderPage()

    await screen.findByText('Mesa 1')
    const statGroup = screen.getByRole('group', { name: 'Resumen de mesas' })
    expect(statGroup).toBeInTheDocument()
    expect(screen.getByText('Asignadas')).toBeInTheDocument()
    expect(screen.getByText('Libres')).toBeInTheDocument()
    expect(screen.getByText('Ocupadas')).toBeInTheDocument()
    expect(screen.getByText('En Cobro', { selector: '.ts-stat__label' })).toBeInTheDocument()
  })

  it('shows "Tú" for tables assigned to current user', async () => {
    renderPage()

    await screen.findByText('Mesa 2')
    expect(screen.getByText('Tú')).toBeInTheDocument()
  })

  it('shows pending call count', async () => {
    renderPage()

    await screen.findByText('Mesa 3')
    expect(screen.getByText('1 llamado')).toBeInTheDocument()
  })

  it('shows error state with retry button', async () => {
    const user = userEvent.setup()
    tablesStatusApi.listTableStatuses.mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'x'))
    const auth = { status: 'authenticated', user: ME, login: vi.fn(), logout: vi.fn() }
    render(
      <MemoryRouter>
        <AuthContext.Provider value={auth}>
          <ToastProvider>
            <WaiterTablesPanelPage />
          </ToastProvider>
        </AuthContext.Provider>
      </MemoryRouter>,
    )

    expect(await screen.findByText('No se pudo cargar el estado de las mesas.')).toBeInTheDocument()

    tablesStatusApi.listTableStatuses.mockResolvedValue(TABLES)
    await user.click(screen.getByRole('button', { name: /Reintentar/ }))
    expect(await screen.findByText('Mesa 1')).toBeInTheDocument()
  })

  it('shows empty state when no tables exist', async () => {
    renderPage([])

    expect(await screen.findByText('No hay mesas registradas.')).toBeInTheDocument()
  })

  it('renders action buttons: Abrir Mesa, Ver Detalle and Cobrar all enabled', async () => {
    renderPage([TABLES[0], TABLES[1], MY_BILLING_TABLE])

    await screen.findByText('Mesa 1')
    expect(screen.getByRole('button', { name: 'Abrir Mesa' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Ver Detalle' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Cobrar' })).toBeEnabled()
  })

  it('opens a table and updates its status to ocupada', async () => {
    const user = userEvent.setup()
    tablesStatusApi.openTable.mockResolvedValue({
      orderId: 'new-order',
      tableId: 't1',
      waiterId: 'user-1',
      status: 'ABIERTA',
      openedAt: '2026-10-30T00:00:00Z',
    })
    renderPage()

    await screen.findByText('Mesa 1')
    await user.click(screen.getByRole('button', { name: 'Abrir Mesa' }))

    expect(tablesStatusApi.openTable).toHaveBeenCalledWith('t1')
    const tuElements = await screen.findAllByText('Tú')
    expect(tuElements).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Abrir Mesa' })).not.toBeInTheDocument()
  })

  it('shows error when opening table fails', async () => {
    const user = userEvent.setup()
    tablesStatusApi.openTable.mockRejectedValue(new ApiError(409, 'TABLE_ALREADY_OPEN', 'La mesa ya tiene una orden abierta'))
    renderPage()

    await screen.findByText('Mesa 1')
    await user.click(screen.getByRole('button', { name: 'Abrir Mesa' }))

    expect(await screen.findByText('La mesa ya tiene una orden abierta')).toBeInTheDocument()
  })

  it('shows "Tomar Pedido" for occupied tables with no items', async () => {
    const tablesNoItems = [
      { tableId: 't2', tableNumber: 2, status: 'ocupada', orderId: 'o1', waiterId: 'user-1', pendingCalls: [], itemsCount: 0 },
    ]
    renderPage(tablesNoItems)

    await screen.findByText('Mesa 2')
    expect(screen.getByRole('button', { name: 'Tomar Pedido' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Ver Detalle' })).not.toBeInTheDocument()
  })

  it('shows "Abriendo…" while the open request is in flight', async () => {
    let resolve
    tablesStatusApi.openTable.mockImplementation(() => new Promise((r) => { resolve = r }))
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('Mesa 1')
    await user.click(screen.getByRole('button', { name: 'Abrir Mesa' }))

    expect(screen.getByRole('button', { name: 'Abriendo…' })).toBeDisabled()
    resolve({ orderId: 'x', tableId: 't1', waiterId: 'user-1', status: 'ABIERTA', openedAt: new Date().toISOString() })
  })
})

describe('WaiterTablesPanelPage — mesa de un compañero', () => {
  const COLLEAGUE_TABLE = {
    tableId: 't4',
    tableNumber: 4,
    status: 'ocupada',
    orderId: 'o4',
    waiterId: 'user-2',
    waiterName: 'Carlos Rojas',
    pendingCalls: [],
    itemsCount: 2,
  }

  it('el mesero la ve ocupada, con el nombre de quien atiende y sin acciones', async () => {
    renderPage([COLLEAGUE_TABLE])

    expect(await screen.findByText('Atiende: Carlos Rojas')).toBeInTheDocument()
    expect(screen.getByText('Ocupada', { selector: '.pill' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /detalle|pedido/i })).not.toBeInTheDocument()
  })

  it('tampoco puede tomarle el pedido si la mesa aun no tiene items', async () => {
    renderPage([{ ...COLLEAGUE_TABLE, itemsCount: 0 }])

    await screen.findByText('Atiende: Carlos Rojas')
    expect(screen.queryByRole('button', { name: /pedido/i })).not.toBeInTheDocument()
  })

  it('si no hay perfil en Staff dice "otro mesero"', async () => {
    renderPage([{ ...COLLEAGUE_TABLE, waiterName: null }])

    expect(await screen.findByText('Atiende: otro mesero')).toBeInTheDocument()
  })

  it('el ADMIN ve el nombre y conserva las acciones', async () => {
    renderPage([COLLEAGUE_TABLE], { ...ME, userId: 'admin-1', role: 'ADMIN' })

    expect(await screen.findByText('Atiende: Carlos Rojas')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ver Detalle' })).toBeEnabled()
  })

  it('en su propia mesa el mesero no ve "Atiende"', async () => {
    renderPage([{ ...COLLEAGUE_TABLE, waiterId: ME.userId }])

    await screen.findByText('Mesa 4')
    expect(screen.queryByText(/Atiende:/)).not.toBeInTheDocument()
  })

  it('si un compañero la abrio primero avisa y recarga el panel', async () => {
    const user = userEvent.setup()
    tablesStatusApi.openTable.mockRejectedValue(
      new ApiError(409, 'TABLE_ALREADY_OPEN', 'La mesa ya tiene una orden abierta'),
    )
    renderPage([TABLES[0]])

    await user.click(await screen.findByRole('button', { name: 'Abrir Mesa' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('La mesa ya tiene una orden abierta')
    expect(tablesStatusApi.listTableStatuses).toHaveBeenCalledTimes(2)
  })
})

describe('WaiterTablesPanelPage — insignia de turno', () => {
  it('con el turno iniciado muestra "Turno Activo"', async () => {
    useActiveShift.mockReturnValue(true)
    renderPage([])

    expect(await screen.findByText('Turno Activo')).toBeInTheDocument()
    expect(screen.queryByText('Sin Turno')).not.toBeInTheDocument()
  })

  it('sin turno iniciado muestra "Sin Turno"', async () => {
    useActiveShift.mockReturnValue(false)
    renderPage([])

    expect(await screen.findByText('Sin Turno')).toBeInTheDocument()
    expect(screen.queryByText('Turno Activo')).not.toBeInTheDocument()
  })

  it('mientras no se sabe no afirma ninguno de los dos', async () => {
    useActiveShift.mockReturnValue(null)
    renderPage([])

    await screen.findByText('No hay mesas registradas.')
    expect(screen.queryByText('Turno Activo')).not.toBeInTheDocument()
    expect(screen.queryByText('Sin Turno')).not.toBeInTheDocument()
  })

  it('al abrir sin turno muestra el mensaje del servidor', async () => {
    const user = userEvent.setup()
    tablesStatusApi.openTable.mockRejectedValue(
      new ApiError(409, 'NO_ACTIVE_SHIFT', 'Debes iniciar tu turno para abrir una mesa'),
    )
    renderPage([TABLES[0]])

    await user.click(await screen.findByRole('button', { name: 'Abrir Mesa' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Debes iniciar tu turno')
  })
})

// Por debajo de 640px el CSS oculta .ts-card__actions (el Figma movil 40:2 no dibuja boton:
// la fila entera es el objetivo). Sin esta fila clicable el mesero se queda sin salida.
describe('WaiterTablesPanelPage — fila clicable en movil', () => {
  const rowButton = (name) => screen.getByRole('button', { name })

  it('cada mesa expone la accion de su estado como boton de fila', async () => {
    renderPage([TABLES[0], TABLES[1], MY_BILLING_TABLE])

    await screen.findByText('Mesa 1')
    expect(rowButton('Mesa 1, abrir mesa')).toBeInTheDocument()
    expect(rowButton('Mesa 2, ver detalle')).toBeInTheDocument()
    expect(rowButton('Mesa 3, cobrar')).toBeInTheDocument()
  })

  it('una mesa ocupada sin items ofrece tomar pedido, no ver detalle', async () => {
    renderPage([
      { tableId: 't2', tableNumber: 2, status: 'ocupada', orderId: 'o1', waiterId: 'user-1', pendingCalls: [], itemsCount: 0 },
    ])

    await screen.findByText('Mesa 2')
    expect(rowButton('Mesa 2, tomar pedido')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mesa 2, ver detalle' })).not.toBeInTheDocument()
  })

  it('lleva al detalle de la orden', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('Mesa 2')
    await user.click(rowButton('Mesa 2, ver detalle'))

    expect(mockNavigate).toHaveBeenCalledWith('/mesero/mesas/o1')
  })

  it('lleva a la toma de pedido con el numero de mesa', async () => {
    const user = userEvent.setup()
    renderPage([
      { tableId: 't2', tableNumber: 2, status: 'ocupada', orderId: 'o1', waiterId: 'user-1', pendingCalls: [], itemsCount: 0 },
    ])

    await screen.findByText('Mesa 2')
    await user.click(rowButton('Mesa 2, tomar pedido'))

    expect(mockNavigate).toHaveBeenCalledWith('/mesero/mesas/o1/nueva-ronda', {
      state: { tableNumber: 2 },
    })
  })

  it('abre una mesa libre desde la fila', async () => {
    const user = userEvent.setup()
    tablesStatusApi.openTable.mockResolvedValue({
      orderId: 'o9', tableId: 't1', waiterId: 'user-1', status: 'ABIERTA', openedAt: new Date().toISOString(),
    })
    renderPage()

    await screen.findByText('Mesa 1')
    await user.click(rowButton('Mesa 1, abrir mesa'))

    expect(tablesStatusApi.openTable).toHaveBeenCalledWith('t1')
  })

  it('se activa con el teclado', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('Mesa 2')
    rowButton('Mesa 2, ver detalle').focus()
    await user.keyboard('{Enter}')

    expect(mockNavigate).toHaveBeenCalledWith('/mesero/mesas/o1')
  })

  it('queda deshabilitada mientras la mesa se esta abriendo, para no abrirla dos veces', async () => {
    let resolve
    tablesStatusApi.openTable.mockImplementation(() => new Promise((r) => { resolve = r }))
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('Mesa 1')
    await user.click(rowButton('Mesa 1, abrir mesa'))

    expect(rowButton('Mesa 1, abrir mesa')).toBeDisabled()
    resolve({ orderId: 'x', tableId: 't1', waiterId: 'user-1', status: 'ABIERTA', openedAt: new Date().toISOString() })
  })

  it('la fila y el boton de escritorio comparten la misma accion', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByText('Mesa 2')
    await user.click(screen.getByRole('button', { name: 'Ver Detalle' }))
    await user.click(rowButton('Mesa 2, ver detalle'))

    expect(mockNavigate).toHaveBeenCalledTimes(2)
    expect(mockNavigate).toHaveBeenNthCalledWith(1, '/mesero/mesas/o1')
    expect(mockNavigate).toHaveBeenNthCalledWith(2, '/mesero/mesas/o1')
  })
})
