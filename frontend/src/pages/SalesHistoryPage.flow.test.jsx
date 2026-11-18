// GC-RPT-0003 (GC-195). La pantalla Ventas de punta a punta contra una API EN MEMORIA que de verdad filtra, pagina y
// resume (las otras pruebas usan respuestas fijas). Asi se comprueba lo que una respuesta fija no puede: que lo que se
// ve corresponde al filtro y a la pagina pedidos, que cambiar un filtro vuelve a la pagina 1 con los datos del filtro
// nuevo, que el detalle es el de la fila elegida y que el Excel sale con los filtros que estan en pantalla.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadSalesHistory, getSalesHistoryOrder, listSalesHistory } from '../api/history.js'
import { listPaymentMethods } from '../api/paymentMethods.js'
import { listEmployees } from '../api/staff.js'
import { listTables } from '../api/tables.js'
import { AuthContext } from '../auth/authContext.js'
import { ToastProvider } from '../components/Toast.jsx'
import { saveFile } from '../utils/salesHistory.js'
import SalesHistoryPage from './SalesHistoryPage.jsx'

vi.mock('../api/history.js', () => ({
  listSalesHistory: vi.fn(),
  getSalesHistoryOrder: vi.fn(),
  downloadSalesHistory: vi.fn(),
}))
vi.mock('../api/paymentMethods.js')
vi.mock('../api/staff.js')
vi.mock('../api/tables.js')
vi.mock('../utils/salesHistory.js', async (original) => ({ ...(await original()), saveFile: vi.fn() }))

const ME = { userId: 'me', email: 'admin@lapizzeta.co', role: 'ADMIN', isActive: true }
const WAITERS = [
  { userId: 'w-ana', fullName: 'Ana Martínez' },
  { userId: 'w-carlos', fullName: 'Carlos Ruiz' },
]
const METHODS = [
  { paymentMethodId: 'm-cash', name: 'Efectivo' },
  { paymentMethodId: 'm-card', name: 'Tarjeta' },
]
const TABLES = [1, 2, 3].map((n) => ({ tableId: `t-${n}`, tableNumber: n }))

// 45 ventas del 14-nov (hoy) y 5 del 13-nov. Referencias R01..R50; la venta n cierra n minutos antes de las 23:00.
// Carlos abre las pares y Ana las impares; las multiplos de 3 son con tarjeta; la mesa rota 1-2-3.
const SALES = Array.from({ length: 50 }, (_, i) => {
  const n = i + 1
  const day = n <= 45 ? '2026-11-14' : '2026-11-13'
  return {
    orderId: `0000000${String(n).padStart(2, '0')}-0000-4000-8000-000000000000`.slice(-36),
    reference: `R${String(n).padStart(2, '0')}`,
    tableId: `t-${(n % 3) + 1}`,
    tableNumber: (n % 3) + 1,
    waiterId: n % 2 === 0 ? 'w-carlos' : 'w-ana',
    openedAt: `${day}T15:00:00.000Z`,
    closedAt: new Date(Date.parse(`${day}T23:00:00-05:00`) - n * 60_000).toISOString(),
    itemsCount: (n % 4) + 1,
    subtotal: 10000 * n,
    discountAmount: 0,
    total: 10000 * n,
    paymentMethodId: n % 3 === 0 ? 'm-card' : 'm-cash',
    day,
  }
})

// La misma regla del backend: dias from..to, filtros, orden por cierre desc, resumen de TODO el filtro
function fakeList(filters, { page, pageSize }) {
  const rows = SALES.filter(
    (s) =>
      s.day >= filters.from &&
      s.day <= filters.to &&
      (!filters.waiterId || s.waiterId === filters.waiterId) &&
      (!filters.tableId || s.tableId === filters.tableId) &&
      (!filters.paymentMethodId || s.paymentMethodId === filters.paymentMethodId),
  ).sort((a, b) => Date.parse(b.closedAt) - Date.parse(a.closedAt))
  const totalSales = rows.reduce((sum, s) => sum + s.total, 0)
  // eslint-disable-next-line no-unused-vars
  const items = rows.slice((page - 1) * pageSize, page * pageSize).map(({ day, ...rest }) => rest)
  return {
    items,
    page,
    pageSize,
    total: rows.length,
    summary: {
      totalSales,
      ordersCount: rows.length,
      averageTicket: rows.length ? Math.round(totalSales / rows.length) : 0,
    },
  }
}

function renderPage() {
  const auth = { status: 'authenticated', user: ME, login: vi.fn(), logout: vi.fn() }
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <SalesHistoryPage />
        </ToastProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

const references = () =>
  within(screen.getByRole('table'))
    .getAllByRole('button', { name: /Ver detalle/ })
    .map((b) => b.textContent)
const summaryValue = (label) =>
  within(screen.getByRole('region', { name: 'Resumen del filtro' })).getByText(label).nextSibling.textContent

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 14, 23, 30))
  listSalesHistory.mockImplementation(async (filters, paging) => fakeList(filters, paging))
  getSalesHistoryOrder.mockImplementation(async (orderId) => {
    const sale = SALES.find((s) => s.orderId === orderId)
    return {
      ...sale,
      lines: [
        {
          productId: 'p',
          productName: `Plato de ${sale.reference}`,
          quantity: 1,
          unitPrice: sale.subtotal,
          lineTotal: sale.subtotal,
        },
      ],
      cashReceived: null,
      changeGiven: null,
    }
  })
  downloadSalesHistory.mockResolvedValue({ blob: new Blob(['PK']), fileName: 'ventas.xlsx' })
  listTables.mockResolvedValue(TABLES)
  listEmployees.mockResolvedValue(WAITERS)
  listPaymentMethods.mockResolvedValue(METHODS)
})
afterEach(() => vi.useRealTimers())

describe('Ventas de punta a punta (API en memoria)', () => {
  it('hoy: 45 ventas en 3 paginas, la mas reciente primero, y el resumen de las 45', async () => {
    renderPage()
    await screen.findByRole('table')
    expect(references()).toHaveLength(20)
    expect(references()[0]).toBe('#R01')
    expect(screen.getByText('Mostrando 1–20 de 45')).toBeInTheDocument()
    expect(summaryValue('Cuentas')).toBe('45')
    // 10.000 x (1 + ... + 45) = 10.350.000
    expect(summaryValue('Total vendido')).toBe('$10.350.000')
  })

  it('la pagina 3 trae las ultimas 5 y el resumen no cambia al paginar', async () => {
    renderPage()
    await screen.findByRole('table')
    await userEvent.click(screen.getByRole('button', { name: /Siguiente/ }))
    await screen.findByText('Mostrando 21–40 de 45')
    expect(references()[0]).toBe('#R21')
    await userEvent.click(screen.getByRole('button', { name: /Siguiente/ }))
    await screen.findByText('Mostrando 41–45 de 45')
    expect(references()).toEqual(['#R41', '#R42', '#R43', '#R44', '#R45'])
    expect(screen.getByRole('button', { name: /Siguiente/ })).toBeDisabled()
    expect(summaryValue('Cuentas')).toBe('45')
  })

  it('cambiar un filtro estando en la pagina 3 vuelve a la 1 con las ventas del filtro nuevo', async () => {
    renderPage()
    await screen.findByRole('table')
    await userEvent.click(screen.getByRole('button', { name: /Siguiente/ }))
    await userEvent.click(await screen.findByRole('button', { name: /Siguiente/ }))
    await screen.findByText('Página 3 de 3')

    await userEvent.selectOptions(screen.getByLabelText('Mesero'), 'w-carlos')

    // Carlos: las 22 pares de hoy -> pagina 1 de 2, empezando por R02
    await screen.findByText('Mostrando 1–20 de 22')
    expect(screen.getByText('Página 1 de 2')).toBeInTheDocument()
    expect(references()[0]).toBe('#R02')
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(rows.every((r) => within(r).queryByText('Carlos Ruiz'))).toBe(true)
    expect(summaryValue('Cuentas')).toBe('22')
  })

  it('filtros combinados y Ayer: el resumen y la tabla siempre son del filtro en pantalla', async () => {
    renderPage()
    await screen.findByRole('table')
    await userEvent.selectOptions(screen.getByLabelText('Método de pago'), 'm-card')
    await screen.findByText('Mostrando 1–15 de 15') // multiplos de 3 hasta 45
    await userEvent.selectOptions(screen.getByLabelText('Mesa'), 't-1') // n % 3 === 0 -> mesa 1
    await screen.findByText('Mostrando 1–15 de 15')
    await userEvent.selectOptions(screen.getByLabelText('Mesa'), 't-2')
    expect(await screen.findByText('No hay ventas cerradas con estos filtros.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Limpiar/ }))
    await screen.findByText('Mostrando 1–20 de 45')
    await userEvent.click(screen.getByRole('button', { name: 'Ayer' }))
    await screen.findByText('Mostrando 1–5 de 5')
    expect(references()).toEqual(['#R46', '#R47', '#R48', '#R49', '#R50'])
  })

  it('el detalle es el de la fila elegida, tambien en otra pagina', async () => {
    renderPage()
    await screen.findByRole('table')
    await userEvent.click(screen.getByRole('button', { name: /Siguiente/ }))
    await screen.findByText('Mostrando 21–40 de 45')
    await userEvent.click(screen.getByRole('button', { name: 'Ver detalle de la venta #R25' }))
    const dialog = await screen.findByRole('dialog', { name: 'Venta #R25' })
    expect(await within(dialog).findByText('Plato de R25')).toBeInTheDocument()
    expect(within(dialog).getByText('Ana Martínez')).toBeInTheDocument()
  })

  it('el Excel sale con los filtros que estan en pantalla (no con los de la carga inicial)', async () => {
    renderPage()
    await screen.findByRole('table')
    await userEvent.click(screen.getByRole('button', { name: 'Esta semana' }))
    await userEvent.selectOptions(screen.getByLabelText('Mesero'), 'w-ana')
    await screen.findByText('Mostrando 1–20 de 25') // 23 impares de hoy + 2 de ayer (R47, R49)

    await userEvent.click(screen.getByRole('button', { name: 'Exportar a Excel' }))
    await waitFor(() => expect(saveFile).toHaveBeenCalled())
    expect(downloadSalesHistory).toHaveBeenCalledWith({
      from: '2026-11-09',
      to: '2026-11-15',
      waiterId: 'w-ana',
      tableId: '',
      paymentMethodId: '',
    })
  })
})
