import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/errors.js'
import * as tablesStatusApi from '../api/tablesStatus.js'
import { AuthContext } from '../auth/authContext.js'
import { ToastProvider } from '../components/Toast.jsx'
import WaiterTablesPanelPage from './WaiterTablesPanelPage.jsx'

vi.mock('../api/tablesStatus.js')
vi.mock('../hooks/useTableStatusSocket.js', () => ({
  useTableStatusSocket: vi.fn(),
}))

const ME = { userId: 'user-1', email: 'mesero@lapizzeta.com', role: 'WAITER', isActive: true }

const TABLES = [
  { tableId: 't1', tableNumber: 1, status: 'libre', pendingCalls: [] },
  { tableId: 't2', tableNumber: 2, status: 'ocupada', orderId: 'o1', waiterId: 'user-1', pendingCalls: [] },
  { tableId: 't3', tableNumber: 3, status: 'en_cobro', orderId: 'o2', waiterId: 'user-2', pendingCalls: [
    { serviceCallId: 'sc1', tableId: 't3', type: 'request_bill', status: 'pendiente', createdAt: '2026-01-01T00:00:00Z' },
  ] },
]

function renderPage(tables = TABLES) {
  tablesStatusApi.listTableStatuses.mockResolvedValue(tables)
  const auth = { status: 'authenticated', user: ME, login: vi.fn(), logout: vi.fn() }
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
    renderPage()

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
