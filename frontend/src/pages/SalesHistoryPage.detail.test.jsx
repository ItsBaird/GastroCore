// GC-RPT-0003 (GC-194). Detalle de una venta y boton "Exportar a Excel" de la pagina Historial de Ventas.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/errors.js'
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
const CASH = 'm-cash'
const CARD = 'm-card'
const ORDER = '3f9a1c7e-0b2d-4e5f-8a9b-1c2d3e4f5a6b'
const TODAY = { from: '2026-11-14', to: '2026-11-14', waiterId: '', tableId: '', paymentMethodId: '' }

const row = {
  orderId: ORDER,
  reference: '3F9A1C',
  tableId: 't-5',
  tableNumber: 5,
  waiterId: 'w-1',
  openedAt: '2026-11-14T18:00:00.000Z',
  closedAt: '2026-11-14T19:22:00.000Z',
  itemsCount: 3,
  subtotal: 64000,
  discountAmount: 4000,
  total: 60000,
  paymentMethodId: CASH,
}
const detail = {
  ...row,
  lines: [
    { productId: 'p1', productName: 'Pizza Margarita', quantity: 2, unitPrice: 28000, lineTotal: 56000 },
    { productId: 'p2', productName: 'Limonada', quantity: 1, unitPrice: 8000, lineTotal: 8000 },
  ],
  cashReceived: 70000,
  changeGiven: 10000,
}
const page = (items, total = items.length) => ({
  items,
  page: 1,
  pageSize: 20,
  total,
  summary: { totalSales: 60000 * total, ordersCount: total, averageTicket: total ? 60000 : 0 },
})

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

const exportButton = () => screen.getByRole('button', { name: 'Exportar a Excel' })

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 14, 23, 30))
  listSalesHistory.mockResolvedValue(page([row]))
  getSalesHistoryOrder.mockResolvedValue(detail)
  listTables.mockResolvedValue([{ tableId: 't-5', tableNumber: 5 }])
  listEmployees.mockResolvedValue([{ userId: 'w-1', fullName: 'Carlos Ruiz' }])
  listPaymentMethods.mockResolvedValue([
    { paymentMethodId: CASH, name: 'Efectivo' },
    { paymentMethodId: CARD, name: 'Tarjeta' },
  ])
})
afterEach(() => vi.useRealTimers())

async function openDetail() {
  renderPage()
  await userEvent.click(await screen.findByRole('button', { name: 'Ver detalle de la venta #3F9A1C' }))
  return screen.findByRole('dialog', { name: 'Venta #3F9A1C' })
}

describe('detalle de una venta (criterio de la HU)', () => {
  it('la referencia de cada fila es un boton que abre el detalle de ESA venta', async () => {
    const dialog = await openDetail()
    expect(getSalesHistoryOrder).toHaveBeenCalledWith(ORDER)
    expect(within(dialog).getByText('Mesa 5')).toBeInTheDocument()
    expect(within(dialog).getByText('Carlos Ruiz')).toBeInTheDocument()
    expect(within(dialog).getByText('Efectivo')).toBeInTheDocument()
  })

  it('muestra las lineas con nombre y precio del snapshot, cantidad y total de cada linea', async () => {
    const dialog = await openDetail()
    const rows = within(await within(dialog).findByRole('table')).getAllByRole('row')
    expect(rows).toHaveLength(3)
    expect(
      within(rows[1])
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['Pizza Margarita', '2', '$28.000', '$56.000'])
    expect(within(rows[2]).getByText('Limonada')).toBeInTheDocument()
  })

  it('subtotal, descuento (en negativo), total y, en efectivo, recibido y cambio', async () => {
    const dialog = await openDetail()
    await within(dialog).findByRole('table')
    const totals = dialog.querySelector('.sale-totals')
    const value = (label) => within(totals).getByText(label).nextSibling.textContent
    expect(value('Subtotal')).toBe('$64.000')
    expect(value('Descuento')).toBe('−$4.000')
    expect(value('Total')).toBe('$60.000')
    expect(value('Efectivo recibido')).toBe('$70.000')
    expect(value('Cambio')).toBe('$10.000')
  })

  it('sin descuento no muestra la fila; con tarjeta no muestra recibido ni cambio', async () => {
    getSalesHistoryOrder.mockResolvedValue({
      ...detail,
      discountAmount: 0,
      total: 64000,
      paymentMethodId: CARD,
      cashReceived: null,
      changeGiven: null,
    })
    const dialog = await openDetail()
    await within(dialog).findByRole('table')
    expect(within(dialog).queryByText('Descuento')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Efectivo recibido')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Cambio')).not.toBeInTheDocument()
  })

  it('mientras carga avisa; si falla (404) lo dice y Reintentar vuelve a pedir', async () => {
    let reject
    getSalesHistoryOrder.mockReturnValueOnce(new Promise((_, r) => (reject = r)))
    const dialog = await openDetail()
    expect(within(dialog).getByText('Cargando productos…')).toBeInTheDocument()

    reject(new ApiError(404, 'ORDER_NOT_FOUND', 'x'))
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('Esta venta ya no está disponible.')

    await userEvent.click(within(alert).getByRole('button', { name: /Reintentar/ }))
    expect(await within(dialog).findByText('Pizza Margarita')).toBeInTheDocument()
    expect(getSalesHistoryOrder).toHaveBeenCalledTimes(2)
  })

  it('se cierra con el boton Cerrar y con Escape', async () => {
    const dialog = await openDetail()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Ver detalle de la venta #3F9A1C' }))
    await screen.findByRole('dialog')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('Exportar a Excel (criterio: con los filtros activos)', () => {
  it('descarga con los filtros ACTIVOS, guarda el archivo y avisa', async () => {
    downloadSalesHistory.mockResolvedValue({
      blob: new Blob(['PK']),
      fileName: 'ventas_2026-11-14_2026-11-14.xlsx',
    })
    renderPage()
    await screen.findByRole('table')
    await userEvent.selectOptions(screen.getByLabelText('Método de pago'), CASH)
    await waitFor(() => expect(exportButton()).toBeEnabled())

    await userEvent.click(exportButton())

    expect(downloadSalesHistory).toHaveBeenCalledWith({ ...TODAY, paymentMethodId: CASH })
    expect(saveFile).toHaveBeenCalledWith(expect.anything(), 'ventas_2026-11-14_2026-11-14.xlsx')
    expect(await screen.findByText('Descargado ventas_2026-11-14_2026-11-14.xlsx')).toBeInTheDocument()
  })

  it('mientras genera dice "Generando…" y no deja pulsar otra vez', async () => {
    let resolve
    downloadSalesHistory.mockReturnValue(new Promise((r) => (resolve = r)))
    renderPage()
    await screen.findByRole('table')
    await userEvent.click(exportButton())
    expect(exportButton()).toBeDisabled()
    expect(exportButton()).toHaveTextContent('Generando…')
    await userEvent.click(exportButton())
    expect(downloadSalesHistory).toHaveBeenCalledTimes(1)
    resolve({ blob: new Blob(['PK']), fileName: 'f.xlsx' })
    await waitFor(() => expect(exportButton()).toHaveTextContent('Exportar a Excel'))
  })

  it('demasiadas ventas (422 EXPORT_TOO_LARGE): aviso claro que se queda visible y se puede cerrar', async () => {
    downloadSalesHistory.mockRejectedValue(
      new ApiError(422, 'EXPORT_TOO_LARGE', 'x', { rows: 12000, max: 10000 }),
    )
    renderPage()
    await screen.findByRole('table')
    await userEvent.click(exportButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'Son demasiadas ventas para un archivo (máximo 10000). Acota el rango de fechas o los filtros.',
    )
    expect(saveFile).not.toHaveBeenCalled()
    expect(screen.getByRole('table')).toBeInTheDocument() // la tabla sigue

    await userEvent.click(within(alert).getByRole('button', { name: 'Cerrar aviso' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('otro error: mensaje generico; al volver a intentar se limpia el aviso anterior', async () => {
    downloadSalesHistory.mockRejectedValueOnce(new ApiError(500, 'X', 'x'))
    downloadSalesHistory.mockResolvedValueOnce({ blob: new Blob(['PK']), fileName: 'f.xlsx' })
    renderPage()
    await screen.findByRole('table')
    await userEvent.click(exportButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo generar el archivo de Excel.')
    await userEvent.click(exportButton())
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('sin ventas en el filtro, mientras carga o con un rango invalido no se puede exportar', async () => {
    listSalesHistory.mockResolvedValueOnce(page([]))
    renderPage()
    await screen.findByText('No hay ventas cerradas con estos filtros.')
    expect(exportButton()).toBeDisabled()
    expect(exportButton()).toHaveAttribute('title', 'No hay ventas para exportar con estos filtros')
  })

  it('es el unico boton primario de la pantalla', async () => {
    renderPage()
    await screen.findByRole('table')
    expect(document.querySelectorAll('.btn--primary')).toHaveLength(1)
  })
})
