import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/errors.js'
import * as tablesApi from '../api/tables.js'
import { AuthContext } from '../auth/authContext.js'
import { ToastProvider } from '../components/Toast.jsx'
import TablesPage from './TablesPage.jsx'

vi.mock('../api/tables.js')

const ME = { userId: 'me', email: 'admin@lapizzeta.com', role: 'ADMIN', isActive: true }
const TABLES = [
  { tableId: 't1', tableNumber: 1, qrToken: 'abc123tokenvalue' },
  { tableId: 't2', tableNumber: 2, qrToken: 'def456tokenvalue' },
]

function renderPage() {
  const auth = { status: 'authenticated', user: ME, login: vi.fn(), logout: vi.fn() }
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <TablesPage />
        </ToastProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  tablesApi.listTables.mockResolvedValue(TABLES)
})

describe('TablesPage', () => {
  it('lista las mesas con su ruta QR', async () => {
    renderPage()
    expect(await screen.findByText('Mesa 1')).toBeInTheDocument()
    expect(screen.getByText('Mesa 2')).toBeInTheDocument()
    expect(screen.getByText('/m/abc123tokenvalue')).toBeInTheDocument()
  })

  it('crea una mesa y la agrega a la cuadricula', async () => {
    const user = userEvent.setup()
    tablesApi.createTable.mockResolvedValue({ tableId: 't3', tableNumber: 3, qrToken: 'ghi789tokenvalue' })
    renderPage()
    await screen.findByText('Mesa 1')

    await user.click(screen.getByRole('button', { name: 'Agregar mesa' }))
    const dialog = screen.getByRole('dialog', { name: 'Nueva mesa' })
    await user.type(within(dialog).getByLabelText('Número de mesa'), '3')
    await user.click(within(dialog).getByRole('button', { name: 'Crear mesa' }))

    await waitFor(() => expect(tablesApi.createTable).toHaveBeenCalledWith({ tableNumber: 3 }))
    expect(await screen.findByText('Mesa 3')).toBeInTheDocument()
    expect(screen.getByText('Mesa creada')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('edita el numero de una mesa', async () => {
    const user = userEvent.setup()
    tablesApi.updateTable.mockResolvedValue({ tableId: 't1', tableNumber: 10, qrToken: 'abc123tokenvalue' })
    renderPage()
    await screen.findByText('Mesa 1')

    await user.click(screen.getByRole('button', { name: 'Editar mesa 1' }))
    const dialog = screen.getByRole('dialog', { name: 'Editar mesa' })
    const input = within(dialog).getByLabelText('Número de mesa')
    await user.clear(input)
    await user.type(input, '10')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(tablesApi.updateTable).toHaveBeenCalledWith('t1', { tableNumber: 10 }))
    expect(await screen.findByText('Mesa 10')).toBeInTheDocument()
  })

  it('muestra el error de numero repetido (409) en el campo', async () => {
    const user = userEvent.setup()
    tablesApi.createTable.mockRejectedValue(new ApiError(409, 'CONFLICT', 'dup'))
    renderPage()
    await screen.findByText('Mesa 1')

    await user.click(screen.getByRole('button', { name: 'Agregar mesa' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Número de mesa'), '1')
    await user.click(within(dialog).getByRole('button', { name: 'Crear mesa' }))

    expect(await within(dialog).findByText('Ya existe una mesa con ese número')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('muestra un error con opcion de reintentar si falla la carga', async () => {
    const user = userEvent.setup()
    tablesApi.listTables.mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'x'))
    renderPage()

    expect(await screen.findByText('No se pudo cargar la lista de mesas.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Reintentar/ }))
    expect(await screen.findByText('Mesa 1')).toBeInTheDocument()
  })
})
