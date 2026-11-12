import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as qrApi from '../api/qr.js'
import { QrApiError } from '../api/qr.js'
import { ToastProvider } from '../components/Toast.jsx'
import { NOTIFIED_MS } from '../hooks/useCallWaiter.js'
import { POLL_MS } from '../hooks/useQrTable.js'
import PublicMenuPage from './PublicMenuPage.jsx'

vi.mock('../api/qr.js', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, getQrTable: vi.fn(), getPublicMenu: vi.fn(), callWaiter: vi.fn() }
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
    products: [
      { productId: 'p1', name: 'Pizza Margherita', description: 'Tomate, mozzarella', price: 22000, photoUrl: '/api/catalog/photos/a.jpg' },
      { productId: 'p2', name: 'Ensalada César', description: null, price: 18500, photoUrl: '/api/catalog/photos/b.jpg' },
    ],
  },
  {
    categoryId: 'c2',
    name: 'Bebidas',
    products: [{ productId: 'p3', name: 'Agua', description: 'Sin gas', price: 2000, photoUrl: '/api/catalog/photos/c.jpg' }],
  },
  { categoryId: 'c3', name: 'Postres', products: [] },
]

function renderPage(path = `/m/${TOKEN}`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/m/:qrToken" element={<PublicMenuPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  qrApi.getQrTable.mockResolvedValue(table('libre'))
  qrApi.getPublicMenu.mockResolvedValue(MENU)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PublicMenuPage: acciones según el estado de la mesa (las decide el backend)', () => {
  it('Esc. 1 mesa libre: menú y "Llamar al mesero"; sin pedir ni cuenta', async () => {
    renderPage()

    expect(await screen.findByText('Pizza Margherita')).toBeInTheDocument()
    expect(screen.getByText('Mesa 5')).toBeInTheDocument()
    expect(screen.getByText(/Aún no hay un mesero asignado/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Llamar al mesero/ })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /Pedir la cuenta/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Agregar/ })).toBeNull()
    expect(qrApi.getQrTable).toHaveBeenCalledWith(TOKEN, expect.anything())
  })

  it('Esc. 2 mesa ocupada: además el punto de entrada del pedido y "Pedir la cuenta" (próximamente)', async () => {
    qrApi.getQrTable.mockResolvedValue(table('ocupada'))
    renderPage()

    expect(await screen.findByText('Estás en la mesa 5. Puedes pedir o llamar a tu mesero.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Llamar al mesero/ })).toBeEnabled()
    const bill = screen.getByRole('button', { name: /Pedir la cuenta/ })
    expect(bill).toBeDisabled()
    expect(bill).toHaveTextContent('Próximamente')
    const add = screen.getByRole('button', { name: 'Agregar Pizza Margherita (próximamente)' })
    expect(add).toBeDisabled()
  })

  it('Esc. 3 mesa en cobro: menú y "Llamar al mesero"; sin pedidos nuevos ni cuenta', async () => {
    qrApi.getQrTable.mockResolvedValue(table('en_cobro'))
    renderPage()

    expect(await screen.findByText(/Tu mesa está en proceso de pago/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Llamar al mesero/ })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /Pedir la cuenta/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Agregar/ })).toBeNull()
  })

  it('sin jerga interna en pantalla', async () => {
    qrApi.getQrTable.mockResolvedValue(table('en_cobro'))
    renderPage()
    await screen.findByText('Pizza Margherita')

    expect(document.body.textContent).not.toMatch(/en_cobro|ocupada|EN_COBRO/)
  })

  it('las pestañas "Mi Pedido" y "Estado" se ven como en el Figma pero deshabilitadas', async () => {
    renderPage()
    await screen.findByText('Pizza Margherita')

    expect(screen.getByText('Menú').closest('[aria-current="page"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: /Mi Pedido/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Estado/ })).toBeDisabled()
  })
})

describe('PublicMenuPage: menú', () => {
  it('categorías sin productos no se muestran; precios con formato COP; foto con alt y carga perezosa', async () => {
    renderPage()
    await screen.findByText('Pizza Margherita')

    expect(screen.getByRole('heading', { name: 'Pizzas' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Postres' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Postres' })).toBeNull()
    expect(screen.getByText('$22.000')).toBeInTheDocument()
    expect(screen.getByText('$18.500')).toBeInTheDocument()
    const photos = screen.getAllByRole('img', { name: /Pizza Margherita|Ensalada César|Agua/ })
    expect(photos[0]).toHaveAttribute('loading', 'eager')
    expect(photos[2]).toHaveAttribute('loading', 'lazy')
  })

  it('si la foto falla se ve el marcador del Figma (porción), sin imagen rota', async () => {
    renderPage()
    const photo = await screen.findByRole('img', { name: 'Agua' })

    fireEvent.error(photo)

    expect(screen.queryByRole('img', { name: 'Agua' })).toBeNull()
    const card = screen.getByText('Agua').closest('li')
    expect(card.querySelector('.qr-photo__placeholder')).not.toBeNull()
  })

  it('el buscador filtra sin tildes y avisa si no hay resultados', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Pizza Margherita')

    await user.type(screen.getByPlaceholderText('Buscar en el menú...'), 'cesar')
    expect(screen.getByText('Ensalada César')).toBeInTheDocument()
    expect(screen.queryByText('Pizza Margherita')).toBeNull()
    expect(screen.queryByText('Agua')).toBeNull()

    await user.clear(screen.getByPlaceholderText('Buscar en el menú...'))
    await user.type(screen.getByPlaceholderText('Buscar en el menú...'), 'xyz')
    expect(screen.getByText('No encontramos productos con “xyz”.')).toBeInTheDocument()
  })

  it('los chips filtran por categoría', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Pizza Margherita')

    await user.click(screen.getByRole('button', { name: 'Bebidas' }))
    expect(screen.getByRole('button', { name: 'Bebidas' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Agua')).toBeInTheDocument()
    expect(screen.queryByText('Pizza Margherita')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Todas' }))
    expect(screen.getByText('Pizza Margherita')).toBeInTheDocument()
  })

  it('menú vacío', async () => {
    qrApi.getPublicMenu.mockResolvedValue([])
    renderPage()

    expect(await screen.findByText('Por ahora no hay productos disponibles.')).toBeInTheDocument()
  })

  it('si solo falla el menú, la mesa se ve y el menú ofrece reintentar', async () => {
    qrApi.getPublicMenu.mockRejectedValueOnce(new QrApiError(0, 'NETWORK_ERROR', 'Sin conexión'))
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('No pudimos cargar el menú.')).toBeInTheDocument()
    expect(screen.getByText('Mesa 5')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Reintentar/ }))
    expect(await screen.findByText('Pizza Margherita')).toBeInTheDocument()
  })
})

describe('PublicMenuPage: errores de la mesa', () => {
  it('QR inválido (404): pantalla amable y sin menú', async () => {
    qrApi.getQrTable.mockRejectedValue(new QrApiError(404, 'NOT_FOUND', 'Mesa no encontrada'))
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Este código QR no es válido' })).toBeInTheDocument()
    expect(screen.getByText('Pide ayuda a un mesero.')).toBeInTheDocument()
    expect(screen.queryByText('Pizza Margherita')).toBeNull()
    expect(screen.queryByRole('button', { name: /Llamar al mesero/ })).toBeNull()
  })

  it('sin conexión: mensaje y reintentar', async () => {
    qrApi.getQrTable.mockRejectedValueOnce(new QrApiError(0, 'NETWORK_ERROR', 'Sin conexión'))
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('Revisa tu conexión a internet e intenta de nuevo.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Reintentar/ }))
    expect(await screen.findByText('Mesa 5')).toBeInTheDocument()
  })

  it('demasiadas consultas (429): mensaje de espera', async () => {
    qrApi.getQrTable.mockRejectedValue(new QrApiError(429, 'RATE_LIMITED', 'Demasiadas solicitudes'))
    renderPage()

    expect(await screen.findByText(/Hay muchas consultas en este momento/)).toBeInTheDocument()
  })
})

describe('PublicMenuPage: Llamar al mesero (GC-QR-0002)', () => {
  const callButton = () => screen.getByRole('button', { name: /Llamar al mesero|Mesero avisado|Avisando|Reintentar llamado/ })
  const feedback = () => document.getElementById('qr-call-feedback')

  it('reposo -> enviando (deshabilitado) -> avisado, con mensaje anunciado', async () => {
    let resolve
    qrApi.callWaiter.mockReturnValue(new Promise((r) => (resolve = r)))
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Pizza Margherita')

    await user.click(callButton())
    expect(callButton()).toHaveTextContent('Avisando…')
    expect(callButton()).toBeDisabled()
    await user.click(callButton())
    expect(qrApi.callWaiter).toHaveBeenCalledTimes(1)

    await act(async () => resolve({}))
    expect(callButton()).toHaveTextContent('Mesero avisado')
    expect(callButton()).toBeDisabled()
    expect(feedback()).toHaveAttribute('aria-live', 'polite')
    expect(feedback()).toHaveTextContent('Avisamos al mesero. En un momento se acercará.')
    expect(qrApi.callWaiter).toHaveBeenCalledWith(TOKEN)
  })

  it('tras un minuto vuelve a reposo', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    qrApi.callWaiter.mockResolvedValue({})
    renderPage()
    await screen.findByText('Pizza Margherita')
    fireEvent.click(callButton())
    await screen.findByText('Avisamos al mesero. En un momento se acercará.')

    await act(() => vi.advanceTimersByTimeAsync(NOTIFIED_MS))

    expect(callButton()).toHaveTextContent('Llamar al mesero')
    expect(callButton()).toBeEnabled()
  })

  it('409 (ya había un llamado) es informativo, no un error', async () => {
    qrApi.callWaiter.mockRejectedValue(new QrApiError(409, 'CONFLICT', 'Ya hay un llamado pendiente para esta mesa'))
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Pizza Margherita')

    await user.click(callButton())

    expect(await screen.findByText('Ya avisamos al mesero, no hace falta volver a llamar.')).toBeInTheDocument()
    expect(feedback()).toHaveClass('qr-call-feedback--info')
    expect(feedback()).not.toHaveClass('qr-call-feedback--warn')
    expect(callButton()).toHaveTextContent('Mesero avisado')
  })

  it('429: pide esperar y deja intentar de nuevo', async () => {
    qrApi.callWaiter.mockRejectedValue(new QrApiError(429, 'RATE_LIMITED', 'Demasiadas solicitudes'))
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Pizza Margherita')

    await user.click(callButton())

    expect(await screen.findByText('Espera unos segundos e intenta de nuevo.')).toBeInTheDocument()
    expect(callButton()).toBeEnabled()
  })

  it('sin conexión: ofrece reintentar y el reintento avisa', async () => {
    qrApi.callWaiter
      .mockRejectedValueOnce(new QrApiError(0, 'NETWORK_ERROR', 'Sin conexión'))
      .mockResolvedValue({})
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Pizza Margherita')

    await user.click(callButton())
    expect(await screen.findByRole('button', { name: /Reintentar llamado/ })).toBeEnabled()
    expect(screen.getByText(/No pudimos avisar al mesero/)).toBeInTheDocument()

    await user.click(callButton())
    expect(await screen.findByText('Avisamos al mesero. En un momento se acercará.')).toBeInTheDocument()
  })

  it('404 al llamar (mesa eliminada): vuelve a consultar y muestra QR inválido', async () => {
    qrApi.callWaiter.mockRejectedValue(new QrApiError(404, 'NOT_FOUND', 'Mesa no encontrada'))
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Pizza Margherita')
    qrApi.getQrTable.mockRejectedValue(new QrApiError(404, 'NOT_FOUND', 'Mesa no encontrada'))

    await user.click(callButton())

    expect(await screen.findByRole('heading', { name: 'Este código QR no es válido' })).toBeInTheDocument()
  })

  it('también en la mesa ocupada y en cobro (lo decide capabilities.callWaiter)', async () => {
    qrApi.getQrTable.mockResolvedValue(table('en_cobro'))
    renderPage()
    await screen.findByText('Pizza Margherita')
    expect(callButton()).toBeEnabled()
  })

  it('sin la capacidad no hay botón', async () => {
    qrApi.getQrTable.mockResolvedValue({ ...table('libre'), capabilities: { ...caps.libre, callWaiter: false } })
    renderPage()
    await screen.findByText('Pizza Margherita')
    expect(screen.queryByRole('button', { name: /Llamar al mesero/ })).toBeNull()
  })
})

describe('PublicMenuPage: actualización del estado (polling)', () => {
  it('cada 30 s vuelve a consultar y los botones cambian sin recargar', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    qrApi.getQrTable.mockResolvedValueOnce(table('libre')).mockResolvedValue(table('ocupada'))
    renderPage()
    await screen.findByText(/Aún no hay un mesero asignado/)
    expect(screen.queryByRole('button', { name: /Pedir la cuenta/ })).toBeNull()

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))

    expect(await screen.findByRole('button', { name: /Pedir la cuenta/ })).toBeInTheDocument()
    expect(qrApi.getQrTable).toHaveBeenCalledTimes(2)
  })

  it('un 404 durante la consulta muestra QR inválido', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    qrApi.getQrTable
      .mockResolvedValueOnce(table('libre'))
      .mockRejectedValue(new QrApiError(404, 'NOT_FOUND', 'Mesa no encontrada'))
    renderPage()
    await screen.findByText('Pizza Margherita')

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))

    expect(await screen.findByRole('heading', { name: 'Este código QR no es válido' })).toBeInTheDocument()
  })

  it('con la pestaña oculta no consulta; al volver, consulta de inmediato', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderPage()
    await screen.findByText('Pizza Margherita')
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => document.dispatchEvent(new Event('visibilitychange')))

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 3))
    expect(qrApi.getQrTable).toHaveBeenCalledTimes(1)

    visibility.mockReturnValue('visible')
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    await waitFor(() => expect(qrApi.getQrTable).toHaveBeenCalledTimes(2))
    visibility.mockRestore()
  })

  it('al desmontar deja de consultar', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { unmount } = renderPage()
    await screen.findByText('Pizza Margherita')
    unmount()

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 3))
    expect(qrApi.getQrTable).toHaveBeenCalledTimes(1)
  })
})

describe('PublicMenuPage: privacidad', () => {
  it('no guarda nada en localStorage ni sessionStorage y pone referrer no-referrer', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { unmount } = renderPage()
    await screen.findByText('Pizza Margherita')

    expect(setItem).not.toHaveBeenCalled()
    expect(document.head.querySelector('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer')
    unmount()
    expect(document.head.querySelector('meta[name="referrer"]')).toBeNull()
    setItem.mockRestore()
  })

  it('el texto del producto se escapa (sin HTML inyectado)', async () => {
    qrApi.getPublicMenu.mockResolvedValue([
      { categoryId: 'c1', name: 'Pizzas', products: [{ productId: 'px', name: '<img src=x onerror=alert(1)>', description: null, price: 1000, photoUrl: '' }] },
    ])
    renderPage()

    const name = await screen.findByText('<img src=x onerror=alert(1)>')
    expect(name.tagName).toBe('H3')
    expect(document.querySelector('img[src="x"]')).toBeNull()
  })
})
