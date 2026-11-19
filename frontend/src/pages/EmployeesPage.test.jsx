import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/errors.js'
import * as staffApi from '../api/staff.js'
import * as usersApi from '../api/users.js'
import { AuthContext } from '../auth/authContext.js'
import { ToastProvider } from '../components/Toast.jsx'
import EmployeesPage from './EmployeesPage.jsx'

vi.mock('../api/staff.js')
vi.mock('../api/users.js')

const ME = { userId: 'me', email: 'admin@lapizzeta.co', role: 'ADMIN', isActive: true }
const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const U3 = '33333333-3333-4333-8333-333333333333'
const USERS = [
  { userId: U1, email: 'carlos@lapizzeta.co', role: 'WAITER', isActive: true },
  { userId: U2, email: 'ana@lapizzeta.co', role: 'COOK', isActive: true },
  { userId: U3, email: 'pedro@lapizzeta.co', role: 'WAITER', isActive: false },
]
const EMPLOYEES = [
  {
    userId: U1,
    fullName: 'Carlos Rodríguez',
    phone: '3001234567',
    documentNumber: '1012345678',
    position: 'Mesero',
    hireDate: '2026-03-15',
  },
  {
    userId: U2,
    fullName: 'Ana Martínez',
    phone: null,
    documentNumber: '52000111',
    position: 'Cocinera',
    hireDate: '2026-01-05',
  },
]

function renderPage() {
  const auth = { status: 'authenticated', user: ME, login: vi.fn(), logout: vi.fn() }
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <EmployeesPage />
        </ToastProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

async function fillForm(dialog, user, { name, doc, position, date, phone }) {
  if (name !== undefined) await user.type(within(dialog).getByLabelText('Nombre completo'), name)
  if (doc !== undefined) await user.type(within(dialog).getByLabelText('Documento'), doc)
  if (phone !== undefined) await user.type(within(dialog).getByLabelText('Teléfono'), phone)
  if (position !== undefined) await user.type(within(dialog).getByLabelText('Cargo'), position)
  if (date !== undefined) await user.type(within(dialog).getByLabelText('Fecha de ingreso'), date)
}

beforeEach(() => {
  vi.resetAllMocks()
  staffApi.listEmployees.mockResolvedValue(EMPLOYEES)
  usersApi.listUsers.mockResolvedValue(USERS)
})

describe('EmployeesPage', () => {
  it('lista los empleados ordenados por nombre con cargo, documento, ingreso y la cuenta', async () => {
    renderPage()
    expect(await screen.findByText('Carlos Rodríguez')).toBeInTheDocument()
    const names = screen.getAllByText(/Rodríguez|Martínez/).map((n) => n.textContent)
    expect(names).toEqual(['Ana Martínez', 'Carlos Rodríguez'])
    expect(screen.getByText('1012345678')).toBeInTheDocument()
    expect(screen.getByText('Mesero')).toBeInTheDocument()
    expect(screen.getByText(/15 mar 2026/)).toBeInTheDocument()
    expect(screen.getByText(/carlos@lapizzeta.co · Mesero/)).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('avisa de los usuarios que todavía no tienen perfil laboral', async () => {
    renderPage()
    expect(await screen.findByText('1 usuario todavía no tiene perfil laboral')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Completar perfil de pedro@lapizzeta.co' })).toBeInTheDocument()
  })

  it('si todos tienen perfil no muestra el aviso', async () => {
    usersApi.listUsers.mockResolvedValue(USERS.slice(0, 2))
    renderPage()
    await screen.findByText('Carlos Rodríguez')
    expect(screen.queryByText(/todavía no tiene/)).not.toBeInTheDocument()
  })

  it('si no cargan los usuarios igual muestra los empleados', async () => {
    usersApi.listUsers.mockRejectedValue(new Error('x'))
    renderPage()
    expect(await screen.findByText('Carlos Rodríguez')).toBeInTheDocument()
    expect(screen.queryByText(/lapizzeta.co ·/)).not.toBeInTheDocument()
  })

  it('error al cargar -> alerta con reintento', async () => {
    staffApi.listEmployees.mockRejectedValueOnce(new Error('x'))
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar la lista de empleados')
    await user.click(screen.getByRole('button', { name: /Reintentar/ }))
    expect(await screen.findByText('Carlos Rodríguez')).toBeInTheDocument()
  })

  it('403 -> mensaje de permiso', async () => {
    staffApi.listEmployees.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'x'))
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso')
  })

  it('sin empleados muestra el estado vacío', async () => {
    staffApi.listEmployees.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText(/Todavía no hay empleados/)).toBeInTheDocument()
  })

  it('registra un empleado con el userId elegido (registro exitoso)', async () => {
    const user = userEvent.setup()
    staffApi.createEmployee.mockResolvedValue({
      userId: U3,
      fullName: 'Pedro López',
      phone: null,
      documentNumber: '80123456',
      position: 'Mesero',
      hireDate: '2026-06-01',
    })
    renderPage()
    await screen.findByText('Carlos Rodríguez')
    await user.click(screen.getByRole('button', { name: 'Agregar empleado' }))
    const dialog = screen.getByRole('dialog', { name: 'Nuevo empleado' })
    await user.selectOptions(within(dialog).getByLabelText('Usuario'), U3)
    await fillForm(dialog, user, {
      name: ' Pedro López ',
      doc: '80123456',
      position: 'Mesero',
      date: '2026-06-01',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Registrar empleado' }))
    await waitFor(() =>
      expect(staffApi.createEmployee).toHaveBeenCalledWith({
        userId: U3,
        fullName: 'Pedro López',
        documentNumber: '80123456',
        position: 'Mesero',
        hireDate: '2026-06-01',
      }),
    )
    expect(await screen.findByText('Pedro López')).toBeInTheDocument()
    expect(screen.getByText('Empleado registrado')).toBeInTheDocument()
    expect(screen.queryByText(/todavía no tiene/)).not.toBeInTheDocument()
  })

  it('"Completar perfil" abre el formulario con el usuario ya elegido', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Completar perfil de pedro@lapizzeta.co' }))
    const dialog = screen.getByRole('dialog', { name: 'Nuevo empleado' })
    expect(within(dialog).getByLabelText('Usuario')).toHaveValue(U3)
  })

  it('solo ofrece usuarios sin perfil; sin ninguno lo indica y bloquea el envío', async () => {
    usersApi.listUsers.mockResolvedValue(USERS.slice(0, 2))
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Carlos Rodríguez')
    await user.click(screen.getByRole('button', { name: 'Agregar empleado' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/Todos los usuarios ya tienen perfil/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Registrar empleado' })).toBeDisabled()
  })

  it('valida los campos obligatorios y la fecha antes de enviar', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Carlos Rodríguez')
    await user.click(screen.getByRole('button', { name: 'Agregar empleado' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Registrar empleado' }))
    // La frase sale dos veces: la opción vacía del selector y el mensaje de error
    expect(within(dialog).getAllByText('Selecciona un usuario')).toHaveLength(2)
    expect(within(dialog).getByText('El nombre es obligatorio')).toBeInTheDocument()
    expect(within(dialog).getByText('El documento es obligatorio')).toBeInTheDocument()
    expect(within(dialog).getByText('El cargo es obligatorio')).toBeInTheDocument()
    expect(within(dialog).getByText('La fecha de ingreso es obligatoria')).toBeInTheDocument()
    expect(staffApi.createEmployee).not.toHaveBeenCalled()
  })

  it('documento duplicado -> el error aparece en el campo documento', async () => {
    const user = userEvent.setup()
    staffApi.createEmployee.mockRejectedValue(new ApiError(409, 'CONFLICT', 'x', { field: 'documentNumber' }))
    renderPage()
    await screen.findByText('Carlos Rodríguez')
    await user.click(screen.getByRole('button', { name: 'Completar perfil de pedro@lapizzeta.co' }))
    const dialog = screen.getByRole('dialog')
    await fillForm(dialog, user, { name: 'Pedro', doc: '1012345678', position: 'Mesero', date: '2026-06-01' })
    await user.click(within(dialog).getByRole('button', { name: 'Registrar empleado' }))
    expect(await within(dialog).findByText('Este número de documento ya está registrado')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Registrar empleado' })).toBeEnabled()
  })

  it('Auth no disponible (503) -> mensaje general en el formulario', async () => {
    const user = userEvent.setup()
    staffApi.createEmployee.mockRejectedValue(new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'x'))
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Completar perfil de pedro@lapizzeta.co' }))
    const dialog = screen.getByRole('dialog')
    await fillForm(dialog, user, { name: 'Pedro', doc: '999', position: 'Mesero', date: '2026-06-01' })
    await user.click(within(dialog).getByRole('button', { name: 'Registrar empleado' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'No se pudo verificar el usuario en Auth',
    )
  })

  it('edita solo lo que cambió (PUT parcial) y el botón empieza deshabilitado', async () => {
    const user = userEvent.setup()
    staffApi.updateEmployee.mockResolvedValue({ ...EMPLOYEES[0], position: 'Cajero', phone: null })
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Editar empleado Carlos Rodríguez' }))
    const dialog = screen.getByRole('dialog', { name: 'Editar empleado' })
    expect(within(dialog).getByText('carlos@lapizzeta.co')).toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Usuario')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
    const position = within(dialog).getByLabelText('Cargo')
    await user.clear(position)
    await user.type(position, 'Cajero')
    await user.clear(within(dialog).getByLabelText('Teléfono'))
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() =>
      expect(staffApi.updateEmployee).toHaveBeenCalledWith(U1, { position: 'Cajero', phone: '' }),
    )
    expect(await screen.findByText('Cajero')).toBeInTheDocument()
    expect(screen.getByText('Cambios guardados')).toBeInTheDocument()
  })
})
