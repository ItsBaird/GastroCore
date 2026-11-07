import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/errors.js'
import { listActiveWaiters } from '../api/activeWaiters.js'
import * as tablesApi from '../api/tables.js'
import { listTableStatuses } from '../api/tablesStatus.js'
import { AuthContext } from '../auth/authContext.js'
import { ToastProvider } from '../components/Toast.jsx'
import { useTableStatusSocket } from '../hooks/useTableStatusSocket.js'
import TablesPage from './TablesPage.jsx'

vi.mock('../api/tables.js')
vi.mock('../api/tablesStatus.js')
vi.mock('../api/activeWaiters.js')
vi.mock('../hooks/useTableStatusSocket.js', () => ({ useTableStatusSocket: vi.fn() }))

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
  listTableStatuses.mockResolvedValue([])
  listActiveWaiters.mockResolvedValue([])
})

describe('TablesPage — reasignar mesa', () => {
  const OPEN = {
    tableId: 't1',
    tableNumber: 1,
    status: 'ocupada',
    orderId: 'o1',
    waiterId: 'w-a',
    waiterName: 'Ana Prueba',
    pendingCalls: [],
  }
  const FREE = { tableId: 't2', tableNumber: 2, status: 'libre', pendingCalls: [] }
  const BETO = { userId: 'w-b', name: 'Beto Prueba' }

  const openModal = async () => {
    const user = userEvent.setup()
    listTableStatuses.mockResolvedValue([OPEN, FREE])
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Reasignar mesa 1' }))
    return { user, dialog: screen.getByRole('dialog', { name: 'Reasignar mesa 1' }) }
  }

  it('muestra el estado y quien atiende; solo las mesas abiertas se pueden reasignar', async () => {
    listTableStatuses.mockResolvedValue([OPEN, FREE])
    renderPage()

    expect(await screen.findByText('Atiende: Ana Prueba')).toBeInTheDocument()
    expect(screen.getByText('Ocupada')).toBeInTheDocument()
    expect(screen.getByText('Libre')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reasignar mesa 1' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reasignar mesa 2' })).not.toBeInTheDocument()
  })

  it('una mesa en cobro tambien se puede reasignar', async () => {
    listTableStatuses.mockResolvedValue([{ ...OPEN, status: 'en_cobro' }])
    renderPage()

    expect(await screen.findByRole('button', { name: 'Reasignar mesa 1' })).toBeInTheDocument()
    expect(screen.getByText('En cobro')).toBeInTheDocument()
  })

  it('si no se puede cargar el estado, las mesas se siguen mostrando', async () => {
    listTableStatuses.mockRejectedValue(new ApiError(503, 'X', 'caido'))
    renderPage()

    expect(await screen.findByText('Mesa 1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reasignar mesa 1' })).not.toBeInTheDocument()
  })

  it('el mesero actual no aparece en la lista', async () => {
    listActiveWaiters.mockResolvedValue([{ userId: 'w-a', name: 'Ana Prueba' }, BETO])
    const { dialog } = await openModal()

    expect(await within(dialog).findByRole('option', { name: 'Beto Prueba' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('option', { name: 'Ana Prueba' })).not.toBeInTheDocument()
    expect(within(dialog).getByText('Ana Prueba')).toBeInTheDocument()
  })

  it('sin meseros disponibles lo dice y no deja confirmar', async () => {
    listActiveWaiters.mockResolvedValue([{ userId: 'w-a', name: 'Ana Prueba' }])
    const { dialog } = await openModal()

    expect(await within(dialog).findByText('No hay meseros con turno activo.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reasignar' })).toBeDisabled()
  })

  it('si falla la lista permite reintentar', async () => {
    const user = userEvent.setup()
    listActiveWaiters.mockRejectedValueOnce(new ApiError(503, 'X', 'caido'))
    listActiveWaiters.mockResolvedValueOnce([BETO])
    const { dialog } = await openModal()

    await user.click(await within(dialog).findByRole('button', { name: 'Reintentar' }))

    expect(await within(dialog).findByRole('option', { name: 'Beto Prueba' })).toBeInTheDocument()
  })

  it('reasigna, avisa y actualiza la tarjeta enviando solo el id del mesero', async () => {
    listActiveWaiters.mockResolvedValue([BETO])
    tablesApi.reassignTable.mockResolvedValue({ orderId: 'o1', waiterId: 'w-b' })
    const { user, dialog } = await openModal()

    await within(dialog).findByRole('option', { name: 'Beto Prueba' })
    await user.selectOptions(within(dialog).getByLabelText('Nuevo mesero'), 'w-b')
    await user.click(screen.getByRole('button', { name: 'Reasignar' }))

    expect(tablesApi.reassignTable).toHaveBeenCalledWith('t1', 'w-b')
    expect(await screen.findByText('Atiende: Beto Prueba')).toBeInTheDocument()
    expect(await screen.findByText('Mesa 1 reasignada a Beto Prueba')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each([
    [409, 'NO_ACTIVE_SHIFT', 'El mesero seleccionado no tiene un turno activo', 2],
    [403, 'FORBIDDEN', 'No tienes permiso', 1],
    [503, 'DEPENDENCY_UNAVAILABLE', 'No se pudo verificar el turno', 1],
  ])('un %i muestra el mensaje en el modal', async (status, code, message, statusLoads) => {
    listActiveWaiters.mockResolvedValue([BETO])
    tablesApi.reassignTable.mockRejectedValue(new ApiError(status, code, message))
    const { user, dialog } = await openModal()

    await within(dialog).findByRole('option', { name: 'Beto Prueba' })
    await user.selectOptions(within(dialog).getByLabelText('Nuevo mesero'), 'w-b')
    await user.click(screen.getByRole('button', { name: 'Reasignar' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message)
    await waitFor(() => expect(listTableStatuses).toHaveBeenCalledTimes(statusLoads))
    expect(screen.getByRole('button', { name: 'Reasignar' })).toBeEnabled()
  })

  it('el evento en tiempo real actualiza quien atiende', async () => {
    listTableStatuses.mockResolvedValue([OPEN])
    renderPage()
    await screen.findByText('Atiende: Ana Prueba')

    const handler = useTableStatusSocket.mock.calls.at(-1)[0]
    act(() => handler({ ...OPEN, waiterId: 'w-b', waiterName: 'Beto Prueba' }))

    expect(screen.getByText('Atiende: Beto Prueba')).toBeInTheDocument()
  })
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
    tablesApi.createTable.mockResolvedValue({
      tableId: 't3',
      tableNumber: 3,
      qrToken: 'ghi789tokenvalue',
    })
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
    tablesApi.updateTable.mockResolvedValue({
      tableId: 't1',
      tableNumber: 10,
      qrToken: 'abc123tokenvalue',
    })
    renderPage()
    await screen.findByText('Mesa 1')

    await user.click(screen.getByRole('button', { name: 'Editar mesa 1' }))
    const dialog = screen.getByRole('dialog', { name: 'Editar mesa' })
    const input = within(dialog).getByLabelText('Número de mesa')
    await user.clear(input)
    await user.type(input, '10')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() =>
      expect(tablesApi.updateTable).toHaveBeenCalledWith('t1', { tableNumber: 10 }),
    )
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
