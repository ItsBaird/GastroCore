import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchServerClockOffset, listKitchenRounds, updateItemStatus } from '../api/kitchen.js'
import { useAuth } from '../auth/useAuth.js'
import { ToastProvider } from '../components/Toast.jsx'
import { useKitchenSocket } from '../hooks/useKitchenSocket.js'
import KitchenPage from './KitchenPage.jsx'

vi.mock('../api/kitchen.js')
vi.mock('../auth/useAuth.js', () => ({ useAuth: vi.fn() }))
vi.mock('../hooks/useKitchenSocket.js', () => ({ useKitchenSocket: vi.fn() }))

const MIN = 60_000
const ago = (ms) => new Date(Date.now() - ms).toISOString()

const item = (itemId, status, extra = {}) => ({
  itemId,
  roundId: 'r1',
  productName: 'Pizza Hawaiana',
  quantity: 1,
  note: null,
  status,
  readyAt: null,
  createdAt: ago(2 * MIN),
  updatedAt: ago(2 * MIN),
  ...extra,
})
const round = (roundId, tableNumber, items, createdAt = ago(2 * MIN)) => ({
  roundId,
  orderId: `o-${roundId}`,
  tableNumber,
  source: 'WAITER',
  createdAt,
  items,
})

let socketProps

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <KitchenPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

const column = (name) => screen.getByRole('region', { name })

beforeEach(() => {
  vi.resetAllMocks()
  useAuth.mockReturnValue({ logout: vi.fn().mockResolvedValue(undefined) })
  fetchServerClockOffset.mockResolvedValue(0)
  listKitchenRounds.mockResolvedValue([])
  useKitchenSocket.mockImplementation((props) => {
    socketProps = props
    return { connected: true }
  })
})

describe('KitchenPage', () => {
  it('ubica cada item en la columna de su estado, con cantidad y nota', async () => {
    listKitchenRounds.mockResolvedValue([
      round('r1', 5, [
        item('a', 'pendiente', { quantity: 2, productName: 'Ensalada César', note: 'Sin crutones' }),
        item('b', 'en_preparacion', { productName: 'Pizza Pepperoni' }),
        item('c', 'listo', { productName: 'Coca-Cola', readyAt: ago(MIN) }),
      ]),
    ])
    renderPage()

    const pending = await screen.findByRole('region', { name: 'Pendiente' })
    expect(within(pending).getByText('2× Ensalada César')).toBeInTheDocument()
    expect(within(pending).getByText('Sin crutones')).toBeInTheDocument()
    expect(within(column('En Preparación')).getByText('1× Pizza Pepperoni')).toBeInTheDocument()
    expect(within(column('Listo')).getByText('1× Coca-Cola')).toBeInTheDocument()
  })

  it('una ronda con estados mezclados aparece como una tarjeta en cada columna', async () => {
    listKitchenRounds.mockResolvedValue([
      round('r1', 5, [item('a', 'pendiente'), item('b', 'en_preparacion')]),
    ])
    renderPage()

    const pending = await screen.findByRole('region', { name: 'Pendiente' })
    expect(within(pending).getByRole('heading', { name: 'Mesa 5' })).toBeInTheDocument()
    expect(within(column('En Preparación')).getByRole('heading', { name: 'Mesa 5' })).toBeInTheDocument()
  })

  it('muestra la ronda mas antigua primero', async () => {
    listKitchenRounds.mockResolvedValue([
      round('vieja', 9, [item('a', 'pendiente')], ago(5 * MIN)),
      round('nueva', 2, [item('b', 'pendiente')], ago(MIN)),
    ])
    renderPage()

    const pending = await screen.findByRole('region', { name: 'Pendiente' })
    const tables = within(pending)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent)
    expect(tables).toEqual(['Mesa 9', 'Mesa 2'])
  })

  it('los contadores cuentan items', async () => {
    listKitchenRounds.mockResolvedValue([
      round('r1', 5, [item('a', 'pendiente'), item('b', 'pendiente'), item('c', 'en_preparacion')]),
    ])
    renderPage()
    await screen.findByRole('region', { name: 'Pendiente' })

    const values = document.querySelectorAll('.kds-counter__value')
    expect([...values].map((value) => value.textContent)).toEqual(['2', '1', '0'])
  })

  it('sin pedidos lo dice', async () => {
    renderPage()

    await screen.findByRole('region', { name: 'Pendiente' })
    expect(screen.getAllByText('Sin pedidos').length).toBeGreaterThan(0)
  })

  describe('avance de estado', () => {
    it('Iniciar pasa el item a preparacion', async () => {
      const user = userEvent.setup()
      const pendiente = item('a', 'pendiente')
      listKitchenRounds.mockResolvedValue([round('r1', 5, [pendiente])])
      updateItemStatus.mockResolvedValue({
        ...pendiente,
        status: 'en_preparacion',
        updatedAt: new Date().toISOString(),
      })
      renderPage()

      await user.click(await screen.findByRole('button', { name: 'Iniciar: 1× Pizza Hawaiana' }))

      expect(updateItemStatus).toHaveBeenCalledWith('a', 'en_preparacion')
      expect(
        await within(column('En Preparación')).findByRole('button', {
          name: 'Listo: 1× Pizza Hawaiana',
        }),
      ).toBeInTheDocument()
    })

    it('Listo pasa el item a listo y ya no tiene acciones', async () => {
      const user = userEvent.setup()
      const preparando = item('a', 'en_preparacion')
      listKitchenRounds.mockResolvedValue([round('r1', 5, [preparando])])
      updateItemStatus.mockResolvedValue({
        ...preparando,
        status: 'listo',
        readyAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      renderPage()

      await user.click(await screen.findByRole('button', { name: 'Listo: 1× Pizza Hawaiana' }))

      expect(updateItemStatus).toHaveBeenCalledWith('a', 'listo')
      const ready = column('Listo')
      expect(await within(ready).findByText('1× Pizza Hawaiana')).toBeInTheDocument()
      expect(within(ready).queryByRole('button')).not.toBeInTheDocument()
    })

    it('bloquea el boton mientras la peticion esta en curso', async () => {
      const user = userEvent.setup()
      listKitchenRounds.mockResolvedValue([round('r1', 5, [item('a', 'pendiente')])])
      updateItemStatus.mockReturnValue(new Promise(() => {}))
      renderPage()

      const button = await screen.findByRole('button', { name: 'Iniciar: 1× Pizza Hawaiana' })
      await user.click(button)

      expect(button).toBeDisabled()
    })

    it('ante un 409 avisa y recarga lo que hay en cocina', async () => {
      const user = userEvent.setup()
      listKitchenRounds
        .mockResolvedValueOnce([round('r1', 5, [item('a', 'pendiente')])])
        .mockResolvedValue([])
      updateItemStatus.mockRejectedValue(
        Object.assign(new Error('No se puede pasar un ítem de cancelado a en_preparacion'), {
          status: 409,
        }),
      )
      renderPage()

      await user.click(await screen.findByRole('button', { name: 'Iniciar: 1× Pizza Hawaiana' }))

      expect(
        await screen.findByText('No se puede pasar un ítem de cancelado a en_preparacion'),
      ).toBeInTheDocument()
      await waitFor(() => expect(listKitchenRounds).toHaveBeenCalledTimes(2))
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: /Iniciar/ })).not.toBeInTheDocument(),
      )
    })

    it('un error de red avisa, no recarga y deja reintentar', async () => {
      const user = userEvent.setup()
      listKitchenRounds.mockResolvedValue([round('r1', 5, [item('a', 'pendiente')])])
      updateItemStatus.mockRejectedValue(Object.assign(new Error('Sin conexión'), { status: 0 }))
      renderPage()

      const button = await screen.findByRole('button', { name: 'Iniciar: 1× Pizza Hawaiana' })
      await user.click(button)

      expect(await screen.findByText('Sin conexión')).toBeInTheDocument()
      expect(listKitchenRounds).toHaveBeenCalledTimes(1)
      expect(button).toBeEnabled()
    })
  })

  describe('tiempo real', () => {
    it('agrega la ronda nueva sin recargar', async () => {
      renderPage()
      await screen.findByRole('region', { name: 'Pendiente' })

      act(() => socketProps.onRoundCreated(round('r2', 8, [item('z', 'pendiente', { roundId: 'r2' })])))

      expect(within(column('Pendiente')).getByRole('heading', { name: 'Mesa 8' })).toBeInTheDocument()
      expect(listKitchenRounds).toHaveBeenCalledTimes(1)
    })

    it('mueve el item que avanzo otro cocinero', async () => {
      listKitchenRounds.mockResolvedValue([round('r1', 5, [item('a', 'pendiente')])])
      renderPage()
      await screen.findByRole('button', { name: /Iniciar/ })

      act(() =>
        socketProps.onItemChanged(
          item('a', 'en_preparacion', { updatedAt: new Date().toISOString() }),
        ),
      )

      expect(within(column('En Preparación')).getByText('1× Pizza Hawaiana')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Iniciar/ })).not.toBeInTheDocument()
    })

    it('quita el item que anulo el mesero', async () => {
      listKitchenRounds.mockResolvedValue([round('r1', 5, [item('a', 'pendiente')])])
      renderPage()
      await screen.findByRole('button', { name: /Iniciar/ })

      act(() =>
        socketProps.onItemChanged(item('a', 'cancelado', { updatedAt: new Date().toISOString() })),
      )

      expect(screen.queryByRole('heading', { name: 'Mesa 5' })).not.toBeInTheDocument()
    })

    it('al reconectar recarga, porque pudo perder eventos', async () => {
      renderPage()
      await screen.findByRole('region', { name: 'Pendiente' })
      listKitchenRounds.mockResolvedValue([round('r9', 3, [item('q', 'pendiente', { roundId: 'r9' })])])

      await act(async () => socketProps.onReconnected())

      expect(screen.getByRole('heading', { name: 'Mesa 3' })).toBeInTheDocument()
    })

    it('si esa recarga falla conserva lo que se ve', async () => {
      listKitchenRounds.mockResolvedValueOnce([round('r1', 5, [item('a', 'pendiente')])])
      renderPage()
      await screen.findByRole('heading', { name: 'Mesa 5' })
      listKitchenRounds.mockRejectedValue(new Error('caido'))

      await act(async () => socketProps.onReconnected())

      expect(screen.getByRole('heading', { name: 'Mesa 5' })).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('avisa cuando no hay conexion', async () => {
      useKitchenSocket.mockReturnValue({ connected: false })
      renderPage()

      expect(await screen.findByText(/Sin conexión en tiempo real/)).toBeInTheDocument()
    })
  })

  describe('alerta de 15 minutos', () => {
    const roundWith = (minutes, status = 'pendiente') =>
      round('r1', 5, [
        item('a', status, {
          createdAt: ago(minutes * MIN),
          readyAt: status === 'listo' ? ago(MIN) : null,
        }),
      ], ago(minutes * MIN))

    it('no alerta antes de tiempo', async () => {
      listKitchenRounds.mockResolvedValue([roundWith(14)])
      renderPage()

      await screen.findByRole('heading', { name: 'Mesa 5' })
      expect(screen.queryByText('Más de 15 min')).not.toBeInTheDocument()
    })

    it.each(['pendiente', 'en_preparacion'])('alerta el item %s demorado', async (status) => {
      listKitchenRounds.mockResolvedValue([roundWith(16, status)])
      renderPage()

      expect(await screen.findByText('Más de 15 min')).toBeInTheDocument()
    })

    it('no alerta un item listo', async () => {
      listKitchenRounds.mockResolvedValue([roundWith(40, 'listo')])
      renderPage()

      await screen.findByRole('heading', { name: 'Mesa 5' })
      expect(screen.queryByText('Más de 15 min')).not.toBeInTheDocument()
    })

    it('mide contra el reloj del servidor, no el del dispositivo', async () => {
      listKitchenRounds.mockResolvedValue([roundWith(10)])
      fetchServerClockOffset.mockResolvedValue(6 * MIN)
      renderPage()

      expect(await screen.findByText('Más de 15 min')).toBeInTheDocument()
    })
  })

  describe('estados de la pantalla', () => {
    it('si la carga falla permite reintentar', async () => {
      const user = userEvent.setup()
      listKitchenRounds.mockRejectedValueOnce(new Error('caido'))
      renderPage()

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'No se pudieron cargar los pedidos de cocina.',
      )

      await user.click(screen.getByRole('button', { name: 'Reintentar' }))

      expect(await screen.findByRole('region', { name: 'Pendiente' })).toBeInTheDocument()
    })

    it('el filtro marca el estado elegido y oculta las otras columnas', async () => {
      const user = userEvent.setup()
      renderPage()
      await screen.findByRole('region', { name: 'Pendiente' })
      const filters = screen.getByRole('group', { name: 'Filtrar por estado' })

      await user.click(within(filters).getByRole('button', { name: 'Listo' }))

      expect(within(filters).getByRole('button', { name: 'Listo' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(column('Pendiente')).toHaveClass('kds-column--filtered')
      expect(column('Listo')).not.toHaveClass('kds-column--filtered')
    })

    it('da acceso a Mi Turno y a cerrar sesion', async () => {
      const user = userEvent.setup()
      const logout = vi.fn().mockResolvedValue(undefined)
      useAuth.mockReturnValue({ logout })
      renderPage()
      await screen.findByRole('region', { name: 'Pendiente' })

      expect(screen.getByRole('link', { name: 'Mi Turno' })).toHaveAttribute('href', '/mi-turno')

      await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }))

      expect(logout).toHaveBeenCalledTimes(1)
    })
  })
})
