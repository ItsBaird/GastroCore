import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/errors.js'
import * as api from '../api/paymentMethods.js'
import { AuthContext } from '../auth/authContext.js'
import { ToastProvider } from '../components/Toast.jsx'
import PaymentMethodsPage from './PaymentMethodsPage.jsx'

vi.mock('../api/paymentMethods.js')

const ME = { userId: 'me', email: 'admin@lapizzeta.co', role: 'ADMIN', isActive: true }
const METHODS = [
  { paymentMethodId: 'm2', name: 'Tarjeta débito', isCash: false, isActive: true },
  { paymentMethodId: 'm1', name: 'Efectivo', isCash: true, isActive: true },
  { paymentMethodId: 'm3', name: 'Cortesía', isCash: false, isActive: false },
]

function renderPage() {
  const auth = { status: 'authenticated', user: ME, login: vi.fn(), logout: vi.fn() }
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <PaymentMethodsPage />
        </ToastProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  api.listPaymentMethods.mockResolvedValue(METHODS)
})

describe('PaymentMethodsPage · lista', () => {
  it('pide todos los metodos (sin filtro: el admin ve tambien los inactivos)', async () => {
    renderPage()
    await screen.findByText('Efectivo')
    expect(api.listPaymentMethods).toHaveBeenCalledWith()
  })

  it('muestra cada metodo por nombre con su tipo y estado', async () => {
    renderPage()
    await screen.findByText('Efectivo')
    const names = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(names).toEqual(['Cortesía', 'Efectivo', 'Tarjeta débito'])
    expect(screen.getByText('Efectivo en caja')).toBeInTheDocument()
    expect(screen.getAllByText('Pago electrónico')).toHaveLength(2)
    expect(screen.getAllByText('Activo')).toHaveLength(2)
    expect(screen.getAllByText('Inactivo')).toHaveLength(1)
  })

  it('los activos ofrecen Desactivar y los inactivos Activar', async () => {
    renderPage()
    await screen.findByText('Efectivo')
    expect(screen.getByRole('button', { name: 'Desactivar método Efectivo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Activar método Cortesía' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Activar método Efectivo' })).not.toBeInTheDocument()
  })

  it('no ofrece Eliminar: el contrato no lo permite, los metodos se desactivan', async () => {
    renderPage()
    await screen.findByText('Efectivo')
    expect(screen.queryByRole('button', { name: /Eliminar/ })).not.toBeInTheDocument()
  })

  it('error al cargar -> alerta con reintento', async () => {
    api.listPaymentMethods.mockRejectedValueOnce(new Error('x'))
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo cargar la lista de métodos de pago',
    )
    await user.click(screen.getByRole('button', { name: /Reintentar/ }))
    expect(await screen.findByText('Efectivo')).toBeInTheDocument()
  })

  it('403 -> mensaje de permiso', async () => {
    api.listPaymentMethods.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'x'))
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso')
  })

  it('sin metodos muestra el estado vacio', async () => {
    api.listPaymentMethods.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText(/Todavía no hay métodos de pago/)).toBeInTheDocument()
  })
})

describe('PaymentMethodsPage · crear', () => {
  async function openCreate(user) {
    await screen.findByText('Efectivo')
    await user.click(screen.getByRole('button', { name: 'Nuevo método' }))
    return screen.getByRole('dialog', { name: 'Nuevo método de pago' })
  }

  it('crea el metodo con is_cash e is_active segun lo indicado', async () => {
    const user = userEvent.setup()
    api.createPaymentMethod.mockResolvedValue({
      paymentMethodId: 'm9',
      name: 'Nequi',
      isCash: false,
      isActive: false,
    })
    renderPage()
    const dialog = await openCreate(user)
    await user.type(within(dialog).getByLabelText('Nombre'), ' Nequi ')
    await user.click(within(dialog).getByRole('checkbox', { name: /Activo/ })) // desmarca: nace inactivo
    await user.click(within(dialog).getByRole('button', { name: 'Crear método' }))
    await waitFor(() =>
      expect(api.createPaymentMethod).toHaveBeenCalledWith({ name: 'Nequi', isCash: false, isActive: false }),
    )
    expect(await screen.findByText('Nequi')).toBeInTheDocument()
    expect(screen.getByText('Método de pago creado')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('por defecto: no es efectivo y nace activo', async () => {
    const user = userEvent.setup()
    api.createPaymentMethod.mockResolvedValue({
      paymentMethodId: 'm9',
      name: 'Datafono',
      isCash: false,
      isActive: true,
    })
    renderPage()
    const dialog = await openCreate(user)
    expect(within(dialog).getByRole('checkbox', { name: /Es efectivo/ })).not.toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: /Activo/ })).toBeChecked()
    await user.type(within(dialog).getByLabelText('Nombre'), 'Datafono')
    await user.click(within(dialog).getByRole('button', { name: 'Crear método' }))
    await waitFor(() =>
      expect(api.createPaymentMethod).toHaveBeenCalledWith({
        name: 'Datafono',
        isCash: false,
        isActive: true,
      }),
    )
  })

  it('marcar "Es efectivo" se envia como isCash=true', async () => {
    const user = userEvent.setup()
    api.createPaymentMethod.mockResolvedValue({
      paymentMethodId: 'm9',
      name: 'Caja 2',
      isCash: true,
      isActive: true,
    })
    renderPage()
    const dialog = await openCreate(user)
    await user.type(within(dialog).getByLabelText('Nombre'), 'Caja 2')
    await user.click(within(dialog).getByRole('checkbox', { name: /Es efectivo/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Crear método' }))
    await waitFor(() =>
      expect(api.createPaymentMethod).toHaveBeenCalledWith({ name: 'Caja 2', isCash: true, isActive: true }),
    )
  })

  it('valida el nombre vacio o demasiado largo antes de enviar', async () => {
    const user = userEvent.setup()
    renderPage()
    const dialog = await openCreate(user)
    await user.click(within(dialog).getByRole('button', { name: 'Crear método' }))
    expect(within(dialog).getByText('El nombre es obligatorio')).toBeInTheDocument()
    expect(api.createPaymentMethod).not.toHaveBeenCalled()
  })

  it('nombre duplicado -> el error aparece en el campo y se puede corregir', async () => {
    const user = userEvent.setup()
    api.createPaymentMethod.mockRejectedValue(new ApiError(409, 'CONFLICT', 'x', { field: 'name' }))
    renderPage()
    const dialog = await openCreate(user)
    await user.type(within(dialog).getByLabelText('Nombre'), 'efectivo')
    await user.click(within(dialog).getByRole('button', { name: 'Crear método' }))
    expect(await within(dialog).findByText('Ya existe un método de pago con ese nombre')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Crear método' })).toBeEnabled()
  })

  it('Auth/red caida -> mensaje general en el formulario', async () => {
    const user = userEvent.setup()
    api.createPaymentMethod.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'x'))
    renderPage()
    const dialog = await openCreate(user)
    await user.type(within(dialog).getByLabelText('Nombre'), 'Nequi')
    await user.click(within(dialog).getByRole('button', { name: 'Crear método' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('No se pudo conectar con el servidor')
  })
})

describe('PaymentMethodsPage · editar', () => {
  it('abre con los datos del metodo, deshabilitado hasta que cambie algo, y envia solo lo que cambio', async () => {
    const user = userEvent.setup()
    api.updatePaymentMethod.mockResolvedValue({ ...METHODS[1], name: 'Efectivo caja', isCash: false })
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Editar método Efectivo' }))
    const dialog = screen.getByRole('dialog', { name: 'Editar método de pago' })
    expect(within(dialog).getByLabelText('Nombre')).toHaveValue('Efectivo')
    expect(within(dialog).getByRole('checkbox', { name: /Es efectivo/ })).toBeChecked()
    expect(within(dialog).getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()

    const name = within(dialog).getByLabelText('Nombre')
    await user.clear(name)
    await user.type(name, 'Efectivo caja')
    await user.click(within(dialog).getByRole('checkbox', { name: /Es efectivo/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() =>
      expect(api.updatePaymentMethod).toHaveBeenCalledWith('m1', { name: 'Efectivo caja', isCash: false }),
    )
    expect(await screen.findByText('Efectivo caja')).toBeInTheDocument()
    expect(screen.getByText('Cambios guardados')).toBeInTheDocument()
  })

  it('renombrar al nombre de otro metodo -> 409 en el campo', async () => {
    const user = userEvent.setup()
    api.updatePaymentMethod.mockRejectedValue(new ApiError(409, 'CONFLICT', 'x', { field: 'name' }))
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Editar método Efectivo' }))
    const dialog = screen.getByRole('dialog')
    const name = within(dialog).getByLabelText('Nombre')
    await user.clear(name)
    await user.type(name, 'Tarjeta débito')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }))
    expect(await within(dialog).findByText('Ya existe un método de pago con ese nombre')).toBeInTheDocument()
  })
})

describe('PaymentMethodsPage · desactivar y activar', () => {
  it('desactivar pide confirmacion, envia solo { name, isActive: false } y el metodo queda inactivo (no se borra)', async () => {
    const user = userEvent.setup()
    api.updatePaymentMethod.mockResolvedValue({ ...METHODS[1], isActive: false })
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Desactivar método Efectivo' }))
    const dialog = screen.getByRole('dialog', { name: 'Desactivar método de pago' })
    expect(within(dialog).getByText(/se conserva en los registros históricos/)).toBeInTheDocument()
    expect(api.updatePaymentMethod).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Desactivar' }))
    await waitFor(() =>
      expect(api.updatePaymentMethod).toHaveBeenCalledWith('m1', { name: 'Efectivo', isActive: false }),
    )
    expect(await screen.findByText('Método desactivado')).toBeInTheDocument()
    // Sigue en la lista, ahora como inactivo y con la opcion de activarlo
    expect(screen.getByText('Efectivo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Activar método Efectivo' })).toBeInTheDocument()
    expect(screen.getAllByText('Inactivo')).toHaveLength(2)
  })

  it('cancelar la confirmacion no cambia nada', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Desactivar método Efectivo' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }))
    expect(api.updatePaymentMethod).not.toHaveBeenCalled()
  })

  it('activar un metodo inactivo es inmediato (sin confirmacion)', async () => {
    const user = userEvent.setup()
    api.updatePaymentMethod.mockResolvedValue({ ...METHODS[2], isActive: true })
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Activar método Cortesía' }))
    await waitFor(() =>
      expect(api.updatePaymentMethod).toHaveBeenCalledWith('m3', { name: 'Cortesía', isActive: true }),
    )
    expect(await screen.findByText('Método activado')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desactivar método Cortesía' })).toBeInTheDocument()
  })

  it('si falla desactivar, avisa y el metodo sigue activo', async () => {
    const user = userEvent.setup()
    api.updatePaymentMethod.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'x'))
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Desactivar método Efectivo' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Desactivar' }))
    expect(await screen.findByText('No se pudo desactivar el método')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desactivar método Efectivo' })).toBeInTheDocument()
  })
})
