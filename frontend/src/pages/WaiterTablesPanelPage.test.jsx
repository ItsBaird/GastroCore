import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/errors.js'
import * as tablesStatusApi from '../api/tablesStatus.js'
import { AuthContext } from '../auth/authContext.js'
import { ToastProvider } from '../components/Toast.jsx'
import { useActiveShift } from '../hooks/useActiveShift.js'
import { sortForSection } from '../utils/waiterTables.js'
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
  {
    tableId: 't3',
    tableNumber: 3,
    status: 'en_cobro',
    orderId: 'o2',
    waiterId: 'user-2',
    waiterName: 'Laura Gómez',
    pendingCalls: [
      { serviceCallId: 'sc1', tableId: 't3', type: 'request_bill', status: 'pendiente', createdAt: '2026-01-01T00:00:00Z' },
    ],
  },
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

// La tarjeta es un <article> con nombre "Mesa N, Estado[, de otro mesero]"
const card = (n) => screen.getByRole('article', { name: new RegExp(`^Mesa ${n},`) })
const findCard = (n) => screen.findByRole('article', { name: new RegExp(`^Mesa ${n},`) })
const section = (title) => screen.getByRole('region', { name: title })
const numbersIn = (title) =>
  within(section(title))
    .getAllByRole('article')
    .map((a) => Number(a.querySelector('.ts-card__number').textContent))

beforeEach(() => {
  vi.resetAllMocks()
})

describe('WaiterTablesPanelPage: resumen y tarjetas (Figma 31:2)', () => {
  it('cada mesa con "Mesa" y su numero, la pastilla del estado y el color del estado', async () => {
    renderPage()

    expect(await findCard(1)).toHaveClass('ts-card--libre')
    expect(within(card(1)).getByText('Libre', { selector: '.pill' })).toBeInTheDocument()
    expect(card(1).querySelector('.ts-card__number')).toHaveTextContent('1')
    expect(card(2)).toHaveClass('ts-card--ocupada')
    expect(within(card(2)).getByText('Ocupada', { selector: '.pill' })).toBeInTheDocument()
    expect(card(3)).toHaveClass('ts-card--en-cobro')
    // El Figma rotula "Ocupada" la tarjeta en cobro (copiado): la pastilla sigue el estado
    expect(within(card(3)).getByText('En cobro', { selector: '.pill' })).toBeInTheDocument()
  })

  it('resumen con Asignadas, Libres, Ocupadas y En cobro, en los colores de los estados', async () => {
    renderPage()
    await findCard(1)

    const stats = within(screen.getByRole('group', { name: 'Resumen de mesas' }))
    const stat = (label) => stats.getByText(label).closest('.ts-stat')
    expect(stat('Asignadas')).toHaveClass('ts-stat--asignadas')
    expect(within(stat('Asignadas')).getByText('3')).toBeInTheDocument()
    expect(within(stat('Libres')).getByText('1')).toBeInTheDocument()
    expect(stat('Ocupadas')).toHaveClass('ts-stat--ocupada')
    expect(within(stat('Ocupadas')).getByText('1')).toBeInTheDocument()
    expect(stat('En cobro')).toHaveClass('ts-stat--en-cobro')
  })

  it('"Atiende: Tú" en la mesa propia y el nombre en la de un compañero', async () => {
    renderPage()
    await findCard(2)

    expect(card(2).querySelector('.ts-card__attendant')).toHaveTextContent('Atiende:Tú')
    expect(card(3).querySelector('.ts-card__attendant')).toHaveTextContent('Atiende:Laura Gómez')
    // La libre no tiene a nadie
    expect(card(1).querySelector('.ts-card__attendant')).toBeNull()
  })

  it('el llamado pendiente va en una etiqueta con icono (roja en el CSS, como "Llamados")', async () => {
    renderPage()
    await findCard(3)
    const badge = within(card(3)).getByText('1 llamado')
    expect(badge).toHaveClass('ts-card__calls')
    expect(badge.querySelector('svg')).not.toBeNull()
    // sin llamados no hay etiqueta
    expect(card(1).querySelector('.ts-card__calls')).toBeNull()
  })

  it('error al cargar con Reintentar', async () => {
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
    expect(await findCard(1)).toBeInTheDocument()
  })

  it('sin mesas registradas', async () => {
    renderPage([])
    expect(await screen.findByText('No hay mesas registradas.')).toBeInTheDocument()
  })
})

describe('WaiterTablesPanelPage: mesas divididas por estado', () => {
  const MANY = [
    { tableId: 'a', tableNumber: 8, status: 'libre', pendingCalls: [] },
    { tableId: 'b', tableNumber: 5, status: 'libre', pendingCalls: [] },
    { tableId: 'c', tableNumber: 7, status: 'ocupada', orderId: 'oc', waiterId: 'user-2', waiterName: 'Laura', pendingCalls: [], itemsCount: 1 },
    { tableId: 'd', tableNumber: 9, status: 'ocupada', orderId: 'od', waiterId: 'user-1', pendingCalls: [], itemsCount: 1 },
    { tableId: 'e', tableNumber: 2, status: 'ocupada', orderId: 'oe', waiterId: 'user-1', pendingCalls: [], itemsCount: 1 },
    { tableId: 'f', tableNumber: 4, status: 'en_cobro', orderId: 'of', waiterId: 'user-2', waiterName: 'Laura', pendingCalls: [] },
    { tableId: 'g', tableNumber: 6, status: 'en_cobro', orderId: 'og', waiterId: 'user-1', pendingCalls: [] },
  ]

  it('tres secciones con su titulo, en el orden Libres, Ocupadas, En cobro', async () => {
    renderPage(MANY)
    await findCard(5)

    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Mesas: Libres',
      'Mesas: Ocupadas',
      'Mesas: En Cobro',
    ])
    expect(numbersIn('Mesas: Libres')).toEqual([5, 8])
  })

  it('en Ocupadas y En cobro van primero las mias (por numero) y despues las de los demas', async () => {
    renderPage(MANY)
    await findCard(5)

    expect(numbersIn('Mesas: Ocupadas')).toEqual([2, 9, 7])
    expect(numbersIn('Mesas: En Cobro')).toEqual([6, 4])
  })

  it('una seccion sin mesas conserva su titulo y lo dice', async () => {
    renderPage([TABLES[0]])
    await findCard(1)

    expect(within(section('Mesas: Ocupadas')).getByText('No hay mesas ocupadas.')).toBeInTheDocument()
    expect(within(section('Mesas: En Cobro')).getByText('No hay mesas en cobro.')).toBeInTheDocument()
  })

  it('sortForSection: propias primero y cada grupo por numero', () => {
    expect(sortForSection(MANY, 'ocupada', 'user-1').map((t) => t.tableNumber)).toEqual([2, 9, 7])
    expect(sortForSection(MANY, 'libre', 'user-1').map((t) => t.tableNumber)).toEqual([5, 8])
    expect(sortForSection([], 'ocupada', 'user-1')).toEqual([])
  })
})

describe('WaiterTablesPanelPage: acciones', () => {
  it('Abrir Mesa, Ver Detalle y Cobrar habilitados en las mesas propias', async () => {
    renderPage([TABLES[0], TABLES[1], MY_BILLING_TABLE])
    await findCard(1)

    expect(within(card(1)).getByRole('button', { name: 'Mesa 1, abrir mesa' })).toHaveTextContent('Abrir Mesa')
    expect(within(card(2)).getByRole('button', { name: 'Mesa 2, ver detalle' })).toBeEnabled()
    expect(within(card(3)).getByRole('button', { name: 'Mesa 3, cobrar' })).toBeEnabled()
  })

  it('"Ver Detalle" es de contorno azul y "Tomar Pedido" azul lleno: se distinguen', async () => {
    renderPage([TABLES[1], { ...TABLES[1], tableId: 't5', tableNumber: 5, orderId: 'o5', itemsCount: 0 }])
    await findCard(2)

    const detail = within(card(2)).getByRole('button', { name: 'Mesa 2, ver detalle' })
    const take = within(card(5)).getByRole('button', { name: 'Mesa 5, tomar pedido' })
    expect(detail).toHaveClass('ts-btn--detalle')
    expect(detail).not.toHaveClass('ts-btn--ocupada')
    expect(take).toHaveClass('ts-btn--ocupada')
  })

  it('abre una mesa y pasa a ocupada (a Ocupadas, como propia)', async () => {
    const user = userEvent.setup()
    tablesStatusApi.openTable.mockResolvedValue({
      orderId: 'new-order',
      tableId: 't1',
      waiterId: 'user-1',
      status: 'ABIERTA',
      openedAt: '2026-10-30T00:00:00Z',
    })
    renderPage()

    await user.click(within(await findCard(1)).getByRole('button', { name: /abrir mesa/i }))

    expect(tablesStatusApi.openTable).toHaveBeenCalledWith('t1')
    expect(await within(section('Mesas: Ocupadas')).findByRole('article', { name: /^Mesa 1,/ })).toBeInTheDocument()
    expect(card(1).querySelector('.ts-card__attendant')).toHaveTextContent('Atiende:Tú')
    expect(screen.queryByRole('button', { name: /abrir mesa/i })).not.toBeInTheDocument()
  })

  it('muestra el error del servidor al abrir', async () => {
    const user = userEvent.setup()
    tablesStatusApi.openTable.mockRejectedValue(new ApiError(409, 'TABLE_ALREADY_OPEN', 'La mesa ya tiene una orden abierta'))
    renderPage()

    await user.click(within(await findCard(1)).getByRole('button', { name: /abrir mesa/i }))

    expect(await screen.findByText('La mesa ya tiene una orden abierta')).toBeInTheDocument()
  })

  it('"Tomar Pedido" en una mesa ocupada sin items, y lleva a la toma de pedido', async () => {
    const user = userEvent.setup()
    renderPage([{ ...TABLES[1], itemsCount: 0 }])

    const take = within(await findCard(2)).getByRole('button', { name: 'Mesa 2, tomar pedido' })
    expect(within(card(2)).queryByRole('button', { name: /ver detalle/ })).not.toBeInTheDocument()
    await user.click(take)

    expect(mockNavigate).toHaveBeenCalledWith('/mesero/mesas/o1/nueva-ronda', { state: { tableNumber: 2 } })
  })

  it('"Abriendo…" deshabilitado mientras se abre, para no abrirla dos veces', async () => {
    let resolve
    tablesStatusApi.openTable.mockImplementation(() => new Promise((r) => { resolve = r }))
    const user = userEvent.setup()
    renderPage()

    await user.click(within(await findCard(1)).getByRole('button', { name: /abrir mesa/i }))

    const button = within(card(1)).getByRole('button', { name: /abrir mesa/i })
    expect(button).toHaveTextContent('Abriendo…')
    expect(button).toBeDisabled()
    await act(async () =>
      resolve({ orderId: 'x', tableId: 't1', waiterId: 'user-1', status: 'ABIERTA', openedAt: new Date().toISOString() }),
    )
  })

  it('Ver Detalle lleva al detalle de la orden, tambien con el teclado', async () => {
    const user = userEvent.setup()
    renderPage()

    within(await findCard(2)).getByRole('button', { name: 'Mesa 2, ver detalle' }).focus()
    await user.keyboard('{Enter}')

    expect(mockNavigate).toHaveBeenCalledWith('/mesero/mesas/o1')
  })
})

describe('WaiterTablesPanelPage: mesa de otro mesero', () => {
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

  it('el mesero la ve con la sombra encima, quien atiende y sin acciones', async () => {
    renderPage([COLLEAGUE_TABLE])

    const mesa = await screen.findByRole('article', { name: 'Mesa 4, Ocupada, de otro mesero' })
    expect(mesa).toHaveClass('ts-card--locked')
    expect(mesa.querySelector('.ts-card__shade')).not.toBeNull()
    expect(mesa.querySelector('.ts-card__attendant')).toHaveTextContent('Atiende:Carlos Rojas')
    expect(within(mesa).queryByRole('button')).not.toBeInTheDocument()
  })

  it('tampoco en cobro ni sin items: ninguna accion', async () => {
    renderPage([
      { ...COLLEAGUE_TABLE, itemsCount: 0 },
      { ...COLLEAGUE_TABLE, tableId: 't5', tableNumber: 5, status: 'en_cobro' },
    ])
    await findCard(4)

    expect(screen.queryByRole('button', { name: /pedido|cobrar/i })).not.toBeInTheDocument()
    expect(card(5)).toHaveClass('ts-card--locked')
  })

  it('si no hay perfil en Staff dice "otro mesero"', async () => {
    renderPage([{ ...COLLEAGUE_TABLE, waiterName: null }])
    expect((await findCard(4)).querySelector('.ts-card__attendant')).toHaveTextContent('Atiende:otro mesero')
  })

  it('el ADMIN la ve sin sombra, con el nombre y con las acciones', async () => {
    renderPage([COLLEAGUE_TABLE], { ...ME, userId: 'admin-1', role: 'ADMIN' })

    const mesa = await findCard(4)
    expect(mesa).not.toHaveClass('ts-card--locked')
    expect(mesa.querySelector('.ts-card__shade')).toBeNull()
    expect(mesa.querySelector('.ts-card__attendant')).toHaveTextContent('Atiende:Carlos Rojas')
    expect(within(mesa).getByRole('button', { name: 'Mesa 4, ver detalle' })).toBeEnabled()
  })

  it('la mesa propia no lleva sombra', async () => {
    renderPage([{ ...COLLEAGUE_TABLE, waiterId: ME.userId }])
    const mesa = await findCard(4)
    expect(mesa).not.toHaveClass('ts-card--locked')
    expect(mesa.querySelector('.ts-card__shade')).toBeNull()
  })

  it('si un compañero la abrio primero avisa y recarga el panel', async () => {
    const user = userEvent.setup()
    tablesStatusApi.openTable.mockRejectedValue(
      new ApiError(409, 'TABLE_ALREADY_OPEN', 'La mesa ya tiene una orden abierta'),
    )
    renderPage([TABLES[0]])

    await user.click(within(await findCard(1)).getByRole('button', { name: /abrir mesa/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('La mesa ya tiene una orden abierta')
    expect(tablesStatusApi.listTableStatuses).toHaveBeenCalledTimes(2)
  })
})

describe('WaiterTablesPanelPage: insignia de turno', () => {
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

    await user.click(within(await findCard(1)).getByRole('button', { name: /abrir mesa/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Debes iniciar tu turno')
  })
})

describe('WaiterTablesPanelPage: Cobrar (GC-ORD-0006)', () => {
  it('la mesa en cobro abre su cuenta', async () => {
    const user = userEvent.setup()
    renderPage([MY_BILLING_TABLE])

    await user.click(within(await findCard(3)).getByRole('button', { name: 'Mesa 3, cobrar' }))

    expect(mockNavigate).toHaveBeenCalledWith('/mesero/mesas/o2/cobro')
  })

  it('pasa a En cobro en vivo con table:status_changed y cambia de seccion', async () => {
    const { useTableStatusSocket } = await import('../hooks/useTableStatusSocket.js')
    renderPage([{ ...MY_BILLING_TABLE, status: 'ocupada', itemsCount: 2 }])
    await within(await findCard(3)).findByRole('button', { name: /ver detalle/ })

    const handler = useTableStatusSocket.mock.calls.at(-1)[0]
    act(() => handler(MY_BILLING_TABLE))

    const mesa = await within(section('Mesas: En Cobro')).findByRole('article', { name: /^Mesa 3,/ })
    expect(within(mesa).getByRole('button', { name: 'Mesa 3, cobrar' })).toBeInTheDocument()
    expect(within(mesa).getByText('En cobro', { selector: '.pill' })).toBeInTheDocument()
  })
})
