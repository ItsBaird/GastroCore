import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as qrApi from '../api/qr.js'
import { QrApiError } from '../api/qr.js'
import { ToastProvider } from '../components/Toast.jsx'
import { STATUS_POLL_MS } from '../hooks/useQrOrderStatus.js'
import PublicMenuPage from './PublicMenuPage.jsx'

// Pestaña "Estado" de la vista QR: lo ya enviado (solicitudes y productos con su paso en cocina) y el total.
vi.mock('../api/qr.js', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    getQrTable: vi.fn(),
    getPublicMenu: vi.fn(),
    getQrOrderStatus: vi.fn(),
    callWaiter: vi.fn(),
    requestBill: vi.fn(),
    sendOrderRequest: vi.fn(),
  }
})

const TOKEN = 'tok_ABC123'
const caps = {
  libre: { viewMenu: true, callWaiter: true, sendRequest: false, requestBill: false },
  ocupada: { viewMenu: true, callWaiter: true, sendRequest: true, requestBill: true },
  en_cobro: { viewMenu: true, callWaiter: true, sendRequest: false, requestBill: false },
}
const table = (status) => ({ tableNumber: 5, status, capabilities: caps[status] })
const MENU = [
  {
    categoryId: 'c1',
    name: 'Pizzas',
    products: [{ productId: 'p1', name: 'Pizza Margherita', description: null, price: 22000, photoUrl: null }],
  },
]

const STATUS = {
  tableNumber: 5,
  status: 'ocupada',
  requests: [
    {
      status: 'pendiente',
      createdAt: '2026-11-26T23:30:00.000Z',
      items: [{ productId: 'p1', quantity: 2, note: 'Sin cebolla' }],
    },
    { status: 'rechazada', createdAt: '2026-11-26T23:10:00.000Z', items: [{ productId: 'zz', quantity: 1, note: null }] },
  ],
  items: [
    { productName: 'Limonada', quantity: 1, note: null, status: 'en_preparacion', lineTotal: 5000 },
    { productName: 'Lasaña', quantity: 1, note: 'Bien caliente', status: 'entregado', lineTotal: 28000 },
    { productName: 'Agua', quantity: 1, note: null, status: 'cancelado', lineTotal: 2000 },
  ],
  subtotal: 33000,
  discountAmount: 0,
  total: 33000,
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/m/${TOKEN}`]}>
      <ToastProvider>
        <Routes>
          <Route path="/m/:qrToken" element={<PublicMenuPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}

const statusTab = () => screen.getByRole('button', { name: /^Estado$/ })
const sheet = () => within(screen.getByRole('dialog', { name: 'Estado de tu pedido' }))

beforeEach(() => {
  vi.resetAllMocks()
  qrApi.getQrTable.mockResolvedValue(table('ocupada'))
  qrApi.getPublicMenu.mockResolvedValue(MENU)
  qrApi.getQrOrderStatus.mockResolvedValue(STATUS)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PublicMenuPage: pestaña "Estado"', () => {
  it('con la mesa libre está deshabilitada y no consulta nada', async () => {
    qrApi.getQrTable.mockResolvedValue(table('libre'))
    renderPage()
    await screen.findByText('Pizza Margherita')

    expect(statusTab()).toBeDisabled()
    expect(qrApi.getQrOrderStatus).not.toHaveBeenCalled()
  })

  it('con la mesa ocupada o en cobro se habilita; no consulta hasta abrirla', async () => {
    renderPage()
    await screen.findByText('Pizza Margherita')

    await waitFor(() => expect(statusTab()).toBeEnabled())
    expect(qrApi.getQrOrderStatus).not.toHaveBeenCalled()
  })

  it('muestra lo enviado al mesero, los productos con su paso en cocina y el total', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Pizza Margherita')
    await user.click(statusTab())

    expect(await sheet().findByText('Enviados al mesero')).toBeInTheDocument()
    expect(qrApi.getQrOrderStatus).toHaveBeenCalledWith(TOKEN, expect.anything())

    // Solicitudes: el nombre sale del menú; si el producto ya no está, un nombre genérico
    expect(sheet().getByText(/2 × Pizza Margherita/)).toBeInTheDocument()
    expect(sheet().getByText(/Sin cebolla/)).toBeInTheDocument()
    expect(sheet().getByText('Esperando al mesero')).toBeInTheDocument()
    expect(sheet().getByText(/1 × Producto/)).toBeInTheDocument()
    expect(sheet().getByText('No aceptado por el mesero')).toBeInTheDocument()

    // Productos de la mesa con su estado, sin jerga interna
    expect(sheet().getByText('En tu mesa')).toBeInTheDocument()
    expect(sheet().getByText('Preparando')).toBeInTheDocument()
    expect(sheet().getByText('Entregado')).toBeInTheDocument()
    expect(sheet().getByText('Cancelado')).toBeInTheDocument()
    expect(sheet().getByText('Nota: Bien caliente')).toBeInTheDocument()
    expect(sheet().getByText('Total hasta ahora')).toBeInTheDocument()
    expect(sheet().getByText('$33.000')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/en_preparacion|pendiente|rechazada/)
  })

  it('sin nada enviado: mensaje que lleva a "Mi Pedido"', async () => {
    qrApi.getQrOrderStatus.mockResolvedValue({ ...STATUS, requests: [], items: [], subtotal: 0, total: 0 })
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Pizza Margherita')
    await user.click(statusTab())

    expect(await sheet().findByText(/Aún no hay productos en tu mesa/)).toBeInTheDocument()
  })

  it('en cobro: muestra el descuento y avisa que se prepara la cuenta', async () => {
    qrApi.getQrTable.mockResolvedValue(table('en_cobro'))
    qrApi.getQrOrderStatus.mockResolvedValue({ ...STATUS, status: 'en_cobro', discountAmount: 3000, total: 30000 })
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Pizza Margherita')
    await waitFor(() => expect(statusTab()).toBeEnabled())
    await user.click(statusTab())

    expect(await sheet().findByText('Tu mesero está preparando tu cuenta.')).toBeInTheDocument()
    expect(sheet().getByText('Descuento')).toBeInTheDocument()
    expect(sheet().getByText('$30.000')).toBeInTheDocument()
  })

  it('error al cargar: permite reintentar', async () => {
    qrApi.getQrOrderStatus.mockRejectedValueOnce(new QrApiError(0, 'NETWORK_ERROR', 'Sin conexión'))
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Pizza Margherita')
    await user.click(statusTab())

    await user.click(await sheet().findByRole('button', { name: /Reintentar/ }))

    expect(await sheet().findByText('En tu mesa')).toBeInTheDocument()
  })

  it('se actualiza sola mientras está abierta y deja de consultar al cerrarla', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage()
    await screen.findByText('Pizza Margherita')
    await user.click(statusTab())
    await sheet().findByText('Preparando')

    qrApi.getQrOrderStatus.mockResolvedValue({
      ...STATUS,
      items: [{ ...STATUS.items[0], status: 'listo' }, ...STATUS.items.slice(1)],
    })
    await act(() => vi.advanceTimersByTimeAsync(STATUS_POLL_MS))
    expect(await sheet().findByText('Listo')).toBeInTheDocument()

    await user.click(sheet().getByRole('button', { name: 'Cerrar Estado' }))
    const calls = qrApi.getQrOrderStatus.mock.calls.length
    await act(() => vi.advanceTimersByTimeAsync(STATUS_POLL_MS * 3))
    expect(qrApi.getQrOrderStatus).toHaveBeenCalledTimes(calls)
  })
})
