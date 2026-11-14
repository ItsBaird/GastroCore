import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  return { ...real, getQrTable: vi.fn(), getPublicMenu: vi.fn(), callWaiter: vi.fn(), sendOrderRequest: vi.fn() }
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
    expect(screen.getByRole('button', { name: 'Agregar Pizza Margherita' })).toBeEnabled()
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

// GC-QR-0003: selección de productos, "Mi Pedido" y envío de la solicitud
describe('PublicMenuPage: pedido del cliente (GC-QR-0003)', () => {
  beforeEach(() => {
    qrApi.getQrTable.mockResolvedValue(table('ocupada'))
  })

  async function addProduct(user, name, { quantity = 1, note = '' } = {}) {
    await user.click(await screen.findByRole('button', { name: `Agregar ${name}` }))
    const dialog = screen.getByRole('dialog', { name: name })
    for (let i = 1; i < quantity; i++) {
      await user.click(within(dialog).getByRole('button', { name: 'Agregar uno' }))
    }
    if (note) await user.type(within(dialog).getByLabelText('Notas para la cocina (opcional)'), note)
    await user.click(within(dialog).getByRole('button', { name: /Agregar a mi pedido/ }))
  }

  const openOrder = (user) => user.click(screen.getByRole('button', { name: /Mi Pedido/ }))
  const inSheet = () => within(screen.getByRole('dialog', { name: 'Mi Pedido' }))

  it('el "+" abre el detalle (70:2) con categoría, nota con contador, cantidad y total referencial', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Agregar Pizza Margherita' }))

    const dialog = screen.getByRole('dialog', { name: 'Pizza Margherita' })
    expect(within(dialog).getByText('Pizzas')).toBeInTheDocument()
    expect(within(dialog).getByText('$22.000', { selector: '.qr-detail__price' })).toBeInTheDocument()
    const note = within(dialog).getByLabelText('Notas para la cocina (opcional)')
    expect(note).toHaveAttribute('maxLength', '255')
    await user.type(note, 'sin cebolla')
    expect(within(dialog).getByText('11/255')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Agregar uno' }))
    expect(within(dialog).getByText('$44.000')).toBeInTheDocument()
    expect(within(dialog).getByText('Total referencial')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Quitar uno' })).toBeEnabled()
  })

  it('Esc cierra el detalle y el foco vuelve al botón que lo abrió', async () => {
    const user = userEvent.setup()
    renderPage()
    const open = await screen.findByRole('button', { name: 'Agregar Pizza Margherita' })
    await user.click(open)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(open).toHaveFocus()
  })

  it('agregar suma al contador de "Mi Pedido" y la hoja lista líneas, notas y total referencial', async () => {
    const user = userEvent.setup()
    renderPage()
    await addProduct(user, 'Pizza Margherita', { quantity: 2, note: 'sin cebolla' })
    await addProduct(user, 'Agua')

    expect(screen.getByRole('button', { name: /Mi Pedido.*3 productos/ })).toBeInTheDocument()
    await openOrder(user)
    const sheet = screen.getByRole('dialog', { name: 'Mi Pedido' })
    expect(within(sheet).getByText('Nota: sin cebolla')).toBeInTheDocument()
    expect(within(sheet).getByText('$46.000')).toBeInTheDocument()
    expect(within(sheet).getByText('Valor referencial; el mesero confirma tu pedido.')).toBeInTheDocument()
  })

  it('envía solo productId, quantity y note (R4: nunca precios ni totales) y muestra la confirmación', async () => {
    qrApi.sendOrderRequest.mockResolvedValue({ qrRequestId: 'q1', status: 'pendiente' })
    const user = userEvent.setup()
    renderPage()
    await addProduct(user, 'Pizza Margherita', { quantity: 2, note: 'sin cebolla' })
    await openOrder(user)

    await user.click(screen.getByRole('button', { name: /Enviar al mesero/ }))

    const [token, lines] = qrApi.sendOrderRequest.mock.calls[0]
    expect(token).toBe(TOKEN)
    expect(lines).toHaveLength(1)
    expect(await screen.findByRole('heading', { name: '¡Pedido enviado!' })).toBeInTheDocument()
    expect(screen.getByText('Tu pedido fue enviado a tu mesero; lo revisará en un momento.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Seguir viendo el menú' }))
    expect(screen.getByRole('button', { name: /^Mi Pedido$/ })).toBeInTheDocument()
  })

  it('400 de producto inexistente marca solo esa línea y conserva el resto', async () => {
    qrApi.sendOrderRequest.mockRejectedValue(
      new QrApiError(400, 'VALIDATION_ERROR', 'Datos de entrada invalidos', {
        fields: [{ path: 'items.1.productId', message: 'El producto no existe' }],
      }),
    )
    const user = userEvent.setup()
    renderPage()
    await addProduct(user, 'Pizza Margherita')
    await addProduct(user, 'Agua')
    await openOrder(user)
    await user.click(screen.getByRole('button', { name: /Enviar al mesero/ }))

    expect(await screen.findByText('Este producto ya no está disponible. Quítalo para enviar.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Enviar al mesero/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Quitar Agua del pedido' }))
    expect(inSheet().getByText('Pizza Margherita')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Enviar al mesero/ })).toBeEnabled()
  })

  it('409 de producto agotado (details.unavailable) marca esa línea', async () => {
    qrApi.sendOrderRequest.mockRejectedValue(
      new QrApiError(409, 'CONFLICT', 'Producto agotado', { unavailable: [{ productId: 'p3', name: 'Agua' }] }),
    )
    const user = userEvent.setup()
    renderPage()
    await addProduct(user, 'Agua')
    await openOrder(user)
    await user.click(screen.getByRole('button', { name: /Enviar al mesero/ }))

    expect(await screen.findByText('Se agotó. Quítalo para enviar el resto.')).toBeInTheDocument()
  })

  it('409 por solicitudes pendientes (pending: 3) pide esperar', async () => {
    qrApi.sendOrderRequest.mockRejectedValue(new QrApiError(409, 'CONFLICT', 'Ya hay solicitudes', { pending: 3 }))
    const user = userEvent.setup()
    renderPage()
    await addProduct(user, 'Agua')
    await openOrder(user)
    await user.click(screen.getByRole('button', { name: /Enviar al mesero/ }))

    expect(await screen.findByText(/Ya tienes pedidos esperando que el mesero los revise/)).toBeInTheDocument()
  })

  it('mesa en cobro al enviar (409): explica, vuelve a consultar y conserva el carrito', async () => {
    qrApi.sendOrderRequest.mockRejectedValue(new QrApiError(409, 'INVALID_TRANSITION', 'En cobro'))
    const user = userEvent.setup()
    renderPage()
    await addProduct(user, 'Agua')
    await openOrder(user)
    qrApi.getQrTable.mockResolvedValue(table('en_cobro'))

    await user.click(screen.getByRole('button', { name: /Enviar al mesero/ }))

    expect((await screen.findAllByText('Tu mesa ya está en proceso de pago; no se aceptan más pedidos.')).length).toBeGreaterThan(0)
    expect(inSheet().getByText('Agua')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: /Enviar al mesero/ })).toBeDisabled())
  })

  it('sin conexión: conserva el carrito, no reintenta solo y avisa del posible duplicado', async () => {
    qrApi.sendOrderRequest.mockRejectedValue(new QrApiError(0, 'NETWORK_ERROR', 'Sin conexión'))
    const user = userEvent.setup()
    renderPage()
    await addProduct(user, 'Agua')
    await openOrder(user)
    await user.click(screen.getByRole('button', { name: /Enviar al mesero/ }))

    expect(await screen.findByText(/el mesero podría recibirlo dos veces/)).toBeInTheDocument()
    expect(inSheet().getByText('Agua')).toBeInTheDocument()
    expect(qrApi.sendOrderRequest).toHaveBeenCalledTimes(1)
  })

  it('si el polling cambia la mesa a en cobro, el carrito se conserva y "Enviar" se deshabilita', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderPage()
    await addProduct(user, 'Agua')
    await openOrder(user)
    qrApi.getQrTable.mockResolvedValue(table('en_cobro'))

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS))

    expect(await screen.findByText('Tu mesa ya está en proceso de pago; no se aceptan más pedidos.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Enviar al mesero/ })).toBeDisabled()
    expect(inSheet().getByText('Agua')).toBeInTheDocument()
  })

  it('con la mesa libre no hay "+" y "Mi Pedido" está deshabilitado', async () => {
    qrApi.getQrTable.mockResolvedValue(table('libre'))
    renderPage()
    await screen.findByText('Pizza Margherita')

    expect(screen.queryByRole('button', { name: /^Agregar / })).toBeNull()
    expect(screen.getByRole('button', { name: /Mi Pedido/ })).toBeDisabled()
  })

  it('la nota del cliente se muestra como texto, nunca como HTML', async () => {
    const user = userEvent.setup()
    renderPage()
    await addProduct(user, 'Agua', { note: '<img src=x onerror=alert(1)>' })
    await openOrder(user)

    expect(screen.getByText('Nota: <img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(document.querySelector('img[src="x"]')).toBeNull()
  })
})
