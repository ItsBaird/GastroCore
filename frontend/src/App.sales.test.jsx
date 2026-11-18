// GC-RPT-0003 (GC-194). Ruta /admin/ventas y entrada "Ventas" del menu: solo el ADMIN la ve y la abre; el WAITER y
// el COOK ni la ven ni pueden entrar (se les redirige a su inicio y no se consulta el historial).
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as historyApi from './api/history.js'
import * as paymentMethodsApi from './api/paymentMethods.js'
import * as staffApi from './api/staff.js'
import * as tablesApi from './api/tables.js'
import * as tablesStatusApi from './api/tablesStatus.js'
import * as usersApi from './api/users.js'
import App from './App.jsx'
import { AuthContext } from './auth/authContext.js'
import { ToastProvider } from './components/Toast.jsx'

vi.mock('./api/history.js')
vi.mock('./api/users.js')
vi.mock('./api/staff.js')
vi.mock('./api/tables.js')
vi.mock('./api/paymentMethods.js')
vi.mock('./api/tablesStatus.js')
vi.mock('./api/kitchen.js', () => ({
  listKitchenRounds: async () => [],
  fetchServerClockOffset: async () => 0,
  updateItemStatus: async () => ({}),
}))
vi.mock('./hooks/useKitchenSocket.js', () => ({ useKitchenSocket: () => ({ connected: true }) }))
vi.mock('./hooks/useTableStatusSocket.js', () => ({ useTableStatusSocket: vi.fn() }))

function renderApp(path, role) {
  const value = {
    status: 'authenticated',
    user: { userId: 'u1', email: `${role.toLowerCase()}@lapizzeta.com`, role },
    expired: false,
    login: vi.fn(),
    logout: vi.fn(),
  }
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthContext.Provider value={value}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  historyApi.listSalesHistory.mockResolvedValue({
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
    summary: { totalSales: 0, ordersCount: 0, averageTicket: 0 },
  })
  usersApi.listUsers.mockResolvedValue([])
  staffApi.listEmployees.mockResolvedValue([])
  staffApi.listShifts.mockResolvedValue([])
  tablesApi.listTables.mockResolvedValue([])
  paymentMethodsApi.listPaymentMethods.mockResolvedValue([])
  tablesStatusApi.listTableStatuses.mockResolvedValue([])
})

describe('ruta /admin/ventas', () => {
  it('el ADMIN abre la pagina desde la entrada "Ventas" del menu', async () => {
    const ui = userEvent.setup()
    renderApp('/admin/usuarios', 'ADMIN')
    const link = await screen.findByRole('link', { name: /Ventas/ })
    expect(link).toHaveAttribute('href', '/admin/ventas')

    await ui.click(link)
    expect(await screen.findByRole('heading', { level: 1, name: 'Historial de Ventas' })).toBeInTheDocument()
    expect(historyApi.listSalesHistory).toHaveBeenCalled()
  })

  it('el ADMIN entra directo por la URL', async () => {
    renderApp('/admin/ventas', 'ADMIN')
    expect(await screen.findByRole('heading', { level: 1, name: 'Historial de Ventas' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Exportar a Excel' })).toBeInTheDocument()
  })

  it.each([
    ['WAITER', 'Mis Mesas'],
    ['COOK', 'Kitchen Display System'],
  ])(
    'el %s no puede entrar: se le redirige a su inicio y no se consulta el historial',
    async (role, home) => {
      renderApp('/admin/ventas', role)
      expect((await screen.findAllByRole('heading', { name: new RegExp(home) })).length).toBeGreaterThan(0)
      expect(screen.queryByRole('heading', { name: 'Historial de Ventas' })).not.toBeInTheDocument()
      expect(historyApi.listSalesHistory).not.toHaveBeenCalled()
    },
  )

  it.each(['WAITER', 'COOK'])('el %s no ve la entrada "Ventas" en su menu', async (role) => {
    renderApp('/', role)
    await screen.findAllByRole('heading')
    expect(screen.queryByRole('link', { name: /^Ventas$/ })).not.toBeInTheDocument()
    expect(document.querySelector('a[href="/admin/ventas"]')).toBeNull()
  })
})
