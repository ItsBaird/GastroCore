import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/errors.js'
import * as usersApi from '../api/users.js'
import { AuthContext } from '../auth/authContext.js'
import { ToastProvider } from '../components/Toast.jsx'
import UsersPage from './UsersPage.jsx'

vi.mock('../api/users.js')

const ME = { userId: 'me', email: 'admin@lapizzeta.com', role: 'ADMIN', isActive: true }
const USERS = [
  ME,
  { userId: 'w1', email: 'ana.martinez@lapizzeta.com', role: 'WAITER', isActive: true },
  { userId: 'w2', email: 'maria.garcia@lapizzeta.com', role: 'WAITER', isActive: false },
  { userId: 'c1', email: 'juan.diaz@lapizzeta.com', role: 'COOK', isActive: true },
]

function renderPage() {
  const auth = { status: 'authenticated', user: ME, login: vi.fn(), logout: vi.fn() }
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <UsersPage />
        </ToastProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

const rowOf = (name) => screen.getByText(name).closest('tr')

beforeEach(() => {
  vi.resetAllMocks()
  usersApi.listUsers.mockResolvedValue(USERS)
})

describe('UsersPage', () => {
  it('muestra el resumen por rol y la tabla con los datos del backend', async () => {
    renderPage()
    expect(await screen.findByText('Ana Martinez')).toBeInTheDocument()

    const stats = screen.getByRole('region', { name: 'Resumen de usuarios' })
    expect(within(stats).getByText('Total Usuarios').nextSibling).toHaveTextContent('4')
    expect(within(stats).getByText('Administradores').nextSibling).toHaveTextContent('1')
    expect(within(stats).getByText('Meseros').nextSibling).toHaveTextContent('2')
    expect(within(stats).getByText('Cocineros').nextSibling).toHaveTextContent('1')

    const row = rowOf('Ana Martinez')
    expect(within(row).getAllByText('ana.martinez@lapizzeta.com').length).toBeGreaterThan(0)
    expect(within(row).getByText('WAITER')).toBeInTheDocument()
    expect(within(row).getByText('Activo')).toBeInTheDocument()
    expect(within(rowOf('Maria Garcia')).getByText('Inactivo')).toBeInTheDocument()
  })

  it('no permite editar ni desactivar la propia cuenta (el backend responderia 403)', async () => {
    renderPage()
    await screen.findByText('Ana Martinez')
    const row = rowOf('Admin')
    expect(within(row).getByText('Tú')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: /Editar/ })).toBeDisabled()
    expect(within(row).getByRole('button', { name: /Desactivar/ })).toBeDisabled()
  })

  it('crea un usuario, lo agrega a la tabla y avisa', async () => {
    const user = userEvent.setup()
    usersApi.createUser.mockResolvedValue({
      userId: 'n1', email: 'nuevo@lapizzeta.com', role: 'COOK', isActive: true,
    })
    renderPage()
    await screen.findByText('Ana Martinez')

    await user.click(screen.getByRole('button', { name: 'Agregar usuario' }))
    const dialog = screen.getByRole('dialog', { name: 'Agregar usuario' })
    await user.type(within(dialog).getByLabelText('Email'), ' nuevo@lapizzeta.com ')
    await user.type(within(dialog).getByLabelText('Contraseña temporal'), 'temporal12345')
    await user.selectOptions(within(dialog).getByLabelText('Rol'), 'COOK')
    await user.click(within(dialog).getByRole('button', { name: 'Crear usuario' }))

    await waitFor(() =>
      expect(usersApi.createUser).toHaveBeenCalledWith({
        email: 'nuevo@lapizzeta.com', password: 'temporal12345', role: 'COOK',
      }),
    )
    expect(await screen.findByText('Nuevo')).toBeInTheDocument()
    expect(screen.getByText('Usuario creado')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('valida en el cliente antes de llamar a la API', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Ana Martinez')

    await user.click(screen.getByRole('button', { name: 'Agregar usuario' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Email'), 'no-es-email')
    await user.type(within(dialog).getByLabelText('Contraseña temporal'), 'corta')
    await user.click(within(dialog).getByRole('button', { name: 'Crear usuario' }))

    const messages = within(dialog)
      .getAllByRole('alert')
      .map((alert) => alert.textContent)
    expect(messages).toEqual([
      'Escribe un email válido',
      'Debe tener al menos 10 caracteres',
      'Selecciona un rol',
    ])
    expect(usersApi.createUser).not.toHaveBeenCalled()
  })

  it('muestra el error del email repetido (409) en el campo', async () => {
    const user = userEvent.setup()
    usersApi.createUser.mockRejectedValue(new ApiError(409, 'EMAIL_ALREADY_EXISTS', 'dup'))
    renderPage()
    await screen.findByText('Ana Martinez')

    await user.click(screen.getByRole('button', { name: 'Agregar usuario' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Email'), 'ana.martinez@lapizzeta.com')
    await user.type(within(dialog).getByLabelText('Contraseña temporal'), 'temporal12345')
    await user.selectOptions(within(dialog).getByLabelText('Rol'), 'WAITER')
    await user.click(within(dialog).getByRole('button', { name: 'Crear usuario' }))

    expect(await within(dialog).findByText('Este email ya está registrado')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument() // el formulario sigue abierto
  })

  it('edita rol y estado con PUT y actualiza la fila', async () => {
    const user = userEvent.setup()
    usersApi.updateUser.mockResolvedValue({ ...USERS[1], role: 'COOK' })
    renderPage()
    await screen.findByText('Ana Martinez')

    await user.click(within(rowOf('Ana Martinez')).getByRole('button', { name: /Editar/ }))
    const dialog = screen.getByRole('dialog', { name: 'Editar usuario' })
    expect(within(dialog).getByLabelText('Email')).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Guardar cambios' })).toBeDisabled() // sin cambios
    await user.selectOptions(within(dialog).getByLabelText('Rol'), 'COOK')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(usersApi.updateUser).toHaveBeenCalledWith('w1', { role: 'COOK', isActive: true }))
    await waitFor(() => expect(within(rowOf('Ana Martinez')).getByText('COOK')).toBeInTheDocument())
  })

  it('pide confirmacion antes de desactivar y luego llama al DELETE', async () => {
    const user = userEvent.setup()
    usersApi.deactivateUser.mockResolvedValue(null)
    renderPage()
    await screen.findByText('Ana Martinez')

    await user.click(within(rowOf('Ana Martinez')).getByRole('button', { name: /Desactivar/ }))
    expect(usersApi.deactivateUser).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: 'Desactivar usuario' })
    await user.click(within(dialog).getByRole('button', { name: 'Desactivar' }))

    await waitFor(() => expect(usersApi.deactivateUser).toHaveBeenCalledWith('w1'))
    await waitFor(() => expect(within(rowOf('Ana Martinez')).getByText('Inactivo')).toBeInTheDocument())
    expect(screen.getByText('Usuario desactivado')).toBeInTheDocument()
  })

  it('reactiva un usuario inactivo sin pedir confirmacion', async () => {
    const user = userEvent.setup()
    usersApi.updateUser.mockResolvedValue({ ...USERS[2], isActive: true })
    renderPage()
    await screen.findByText('Maria Garcia')

    await user.click(within(rowOf('Maria Garcia')).getByRole('button', { name: /Reactivar/ }))

    await waitFor(() => expect(usersApi.updateUser).toHaveBeenCalledWith('w2', { isActive: true }))
    await waitFor(() => expect(within(rowOf('Maria Garcia')).getByText('Activo')).toBeInTheDocument())
  })

  it('muestra un error con opcion de reintentar si falla la carga', async () => {
    const user = userEvent.setup()
    usersApi.listUsers.mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'x'))
    renderPage()

    expect(await screen.findByText('No se pudo cargar la lista de usuarios.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Reintentar/ }))
    expect(await screen.findByText('Ana Martinez')).toBeInTheDocument()
  })
})
