import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as staffApi from './api/staff.js'
import * as tablesStatusApi from './api/tablesStatus.js'
import * as usersApi from './api/users.js'
import App from './App.jsx'
import { AuthContext } from './auth/authContext.js'
import { ToastProvider } from './components/Toast.jsx'

vi.mock('./api/users.js')
vi.mock('./api/staff.js')
vi.mock('./api/tablesStatus.js')
vi.mock('./api/kitchen.js', () => ({
  listKitchenRounds: async () => [],
  fetchServerClockOffset: async () => 0,
  updateItemStatus: async () => ({}),
}))
vi.mock('./hooks/useKitchenSocket.js', () => ({
  useKitchenSocket: () => ({ connected: true }),
}))
vi.mock('./hooks/useTableStatusSocket.js', () => ({
  useTableStatusSocket: vi.fn(),
}))

function renderApp(path, auth) {
  const value = {
    status: 'authenticated',
    user: null,
    expired: false,
    login: vi.fn(),
    logout: vi.fn(),
    ...auth,
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

const as = (role) => ({ user: { userId: 'u1', email: `${role.toLowerCase()}@lapizzeta.com`, role } })
const anonymous = { status: 'anonymous', user: null }

beforeEach(() => {
  vi.resetAllMocks()
  usersApi.listUsers.mockResolvedValue([])
  staffApi.listShifts.mockResolvedValue([])
  tablesStatusApi.listTableStatuses.mockResolvedValue([])
})

describe('rutas de la aplicacion', () => {
  describe('sin sesion', () => {
    it('la raiz lleva al login', () => {
      renderApp('/', anonymous)
      expect(screen.getByRole('heading', { name: 'Iniciar Sesión' })).toBeInTheDocument()
    })

    it('la gestion de usuarios exige iniciar sesion y no consulta la API', () => {
      renderApp('/admin/usuarios', anonymous)
      expect(screen.getByRole('heading', { name: 'Iniciar Sesión' })).toBeInTheDocument()
      expect(usersApi.listUsers).not.toHaveBeenCalled()
    })

    it('/en-construccion tambien exige sesion', () => {
      renderApp('/en-construccion', anonymous)
      expect(screen.getByRole('heading', { name: 'Iniciar Sesión' })).toBeInTheDocument()
    })

    it('una ruta inexistente muestra "no encontrada" con enlace al login', () => {
      renderApp('/nada-por-aqui', anonymous)
      expect(screen.getByRole('heading', { name: 'Página no encontrada' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/login')
    })
  })

  describe('ADMIN', () => {
    it('la raiz y /admin llevan a la gestion de usuarios', async () => {
      renderApp('/', as('ADMIN'))
      expect(await screen.findByRole('heading', { name: 'Gestión de Usuarios' })).toBeInTheDocument()
    })

    it('/admin sin subruta tambien lleva a usuarios', async () => {
      renderApp('/admin', as('ADMIN'))
      expect(await screen.findByRole('heading', { name: 'Gestión de Usuarios' })).toBeInTheDocument()
    })

    it('si ya inicio sesion, /login lo devuelve a su inicio', async () => {
      renderApp('/login', as('ADMIN'))
      expect(await screen.findByRole('heading', { name: 'Gestión de Usuarios' })).toBeInTheDocument()
    })

    it('"no encontrada" ofrece volver a su inicio', () => {
      renderApp('/nada-por-aqui', as('ADMIN'))
      expect(screen.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute(
        'href',
        '/admin/usuarios',
      )
    })
  })

  describe('WAITER', () => {
    it('la raiz lleva al panel de mesas', async () => {
      renderApp('/', as('WAITER'))
      expect(await screen.findByRole('heading', { name: 'Mis Mesas' })).toBeInTheDocument()
    })

    it('no puede abrir la gestion de usuarios: se le redirige y no se llama a la API', async () => {
      renderApp('/admin/usuarios', as('WAITER'))
      expect(await screen.findByRole('heading', { name: 'Mis Mesas' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Gestión de Usuarios' })).not.toBeInTheDocument()
      expect(usersApi.listUsers).not.toHaveBeenCalled()
    })

    it('si ya inicio sesion, /login lo devuelve a su inicio', async () => {
      renderApp('/login', as('WAITER'))
      expect(await screen.findByRole('heading', { name: 'Mis Mesas' })).toBeInTheDocument()
    })

    it('el boton de cerrar sesion llama al logout del contexto', async () => {
      const logout = vi.fn().mockResolvedValue(undefined)
      renderApp('/mesero/mesas', { ...as('WAITER'), logout })
      await screen.findByRole('heading', { name: 'Mis Mesas' })
      await userEvent.setup().click(screen.getByRole('button', { name: /Cerrar Sesión|Salir/ }))
      await waitFor(() => expect(logout).toHaveBeenCalledTimes(1))
    })
  })

  describe('COOK', () => {
    it('la raiz lleva a la cocina', () => {
      renderApp('/', as('COOK'))
      expect(screen.getByRole('heading', { name: /Kitchen Display System/ })).toBeInTheDocument()
    })

    it('no puede abrir la gestion de usuarios: se le redirige y no se llama a la API', () => {
      renderApp('/admin/usuarios', as('COOK'))
      expect(screen.getByRole('heading', { name: /Kitchen Display System/ })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Gestión de Usuarios' })).not.toBeInTheDocument()
      expect(usersApi.listUsers).not.toHaveBeenCalled()
    })

    it('si ya inicio sesion, /login lo devuelve a su inicio', () => {
      renderApp('/login', as('COOK'))
      expect(screen.getByRole('heading', { name: /Kitchen Display System/ })).toBeInTheDocument()
    })

    it('el boton de cerrar sesion llama al logout del contexto', async () => {
      const logout = vi.fn().mockResolvedValue(undefined)
      renderApp('/en-construccion', { ...as('COOK'), logout })
      await userEvent.setup().click(screen.getByRole('button', { name: 'Cerrar sesión' }))
      await waitFor(() => expect(logout).toHaveBeenCalledTimes(1))
    })
  })

  describe('Mi turno (inicio y fin de turno)', () => {
    it('el mesero llega a "Mi Turno" desde su menu, sin la insignia fija de turno activo', async () => {
      renderApp('/mesero/turno', as('WAITER'))
      expect(await screen.findByRole('heading', { name: 'Mi Turno' })).toBeInTheDocument()
      expect(await screen.findByText('Sin turnos programados')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /Mi Turno/ })).toHaveAttribute('href', '/mesero/turno')
      expect(screen.queryByText('Turno Activo')).not.toBeInTheDocument()
      expect(staffApi.listShifts).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }))
    })

    it('el cocinero (sin panel propio) llega a su turno desde la pantalla en construccion', async () => {
      renderApp('/en-construccion', as('COOK'))
      expect(screen.getByRole('link', { name: 'Ir a mi turno' })).toHaveAttribute('href', '/mi-turno')
    })

    it('/mi-turno muestra el turno del cocinero con cierre de sesion', async () => {
      const logout = vi.fn().mockResolvedValue(undefined)
      renderApp('/mi-turno', { ...as('COOK'), logout })
      expect(await screen.findByRole('heading', { name: 'Mi turno' })).toBeInTheDocument()
      expect(await screen.findByText('Sin turnos programados')).toBeInTheDocument()
      await userEvent.setup().click(screen.getByRole('button', { name: 'Cerrar sesión' }))
      await waitFor(() => expect(logout).toHaveBeenCalledTimes(1))
    })

    it('/mi-turno exige iniciar sesion y no consulta la API', () => {
      renderApp('/mi-turno', anonymous)
      expect(screen.getByRole('heading', { name: 'Iniciar Sesión' })).toBeInTheDocument()
      expect(staffApi.listShifts).not.toHaveBeenCalled()
    })

    it('un cocinero no entra al panel del mesero', () => {
      renderApp('/mesero/turno', as('COOK'))
      expect(screen.getByRole('heading', { name: /Kitchen Display System/ })).toBeInTheDocument()
    })

    it('desde su turno el cocinero vuelve a la cocina', async () => {
      renderApp('/mi-turno', as('COOK'))
      expect(await screen.findByRole('link', { name: 'Ir a cocina' })).toHaveAttribute('href', '/cocina')
    })

    it('el ADMIN entra a la cocina', () => {
      renderApp('/cocina', as('ADMIN'))
      expect(screen.getByRole('heading', { name: /Kitchen Display System/ })).toBeInTheDocument()
    })

    it('un mesero no entra a la cocina', () => {
      renderApp('/cocina', as('WAITER'))
      expect(screen.queryByRole('heading', { name: /Kitchen Display System/ })).not.toBeInTheDocument()
    })
  })
})
