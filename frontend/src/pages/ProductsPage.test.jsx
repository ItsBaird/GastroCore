import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as catalogApi from '../api/catalog.js'
import { ApiError } from '../api/errors.js'
import { AuthContext } from '../auth/authContext.js'
import { ToastProvider } from '../components/Toast.jsx'
import ProductsPage from './ProductsPage.jsx'

vi.mock('../api/catalog.js')

const ME = { userId: 'me', email: 'admin@lapizzeta.com', role: 'ADMIN', isActive: true }
const CATS = [
  { categoryId: 'c1', name: 'Pizzas', displayOrder: 1 },
  { categoryId: 'c2', name: 'Bebidas', displayOrder: 2 },
]
const PRODUCTS = [
  {
    productId: 'p1',
    categoryId: 'c1',
    name: 'Pizza Margarita',
    description: 'Tomate y mozzarella',
    price: 28000,
    photoUrl: '/api/catalog/photos/a.jpg',
    isAvailable: true,
  },
  {
    productId: 'p2',
    categoryId: 'c2',
    name: 'Limonada Natural',
    description: null,
    price: 7000,
    photoUrl: '/api/catalog/photos/b.jpg',
    isAvailable: false,
  },
]

function renderPage() {
  const auth = { status: 'authenticated', user: ME, login: vi.fn(), logout: vi.fn() }
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <ProductsPage />
        </ToastProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

const photoFile = (name = 'foto.png', type = 'image/png', size = 1000) => {
  const file = new File(['x'], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

beforeEach(() => {
  vi.resetAllMocks()
  catalogApi.listProducts.mockResolvedValue(PRODUCTS)
  catalogApi.listCategories.mockResolvedValue(CATS)
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview')
  globalThis.URL.revokeObjectURL = vi.fn()
})

describe('ProductsPage', () => {
  it('lista los productos con categoria, precio en COP y estado', async () => {
    renderPage()
    expect(await screen.findByText('Pizza Margarita')).toBeInTheDocument()
    expect(screen.getByText('Tomate y mozzarella')).toBeInTheDocument()
    expect(screen.getByText(/28\.000/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Pizza Margarita: disponible/ })).toHaveTextContent(
      'Disponible',
    )
    expect(screen.getByRole('button', { name: /Limonada Natural: agotado/ })).toHaveTextContent('Agotado')
  })

  it('muestra un error con opcion de reintentar', async () => {
    catalogApi.listProducts.mockRejectedValueOnce(new Error('x'))
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar la lista de productos')
    await user.click(screen.getByRole('button', { name: /Reintentar/ }))
    expect(await screen.findByText('Pizza Margarita')).toBeInTheDocument()
  })

  it('filtra por texto y por categoria', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Pizza Margarita')

    await user.type(screen.getByLabelText('Buscar producto'), 'limon')
    expect(screen.queryByText('Pizza Margarita')).not.toBeInTheDocument()
    expect(screen.getByText('Limonada Natural')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Buscar producto'))
    await user.selectOptions(screen.getByLabelText('Filtrar por categoría'), 'c1')
    expect(screen.getByText('Pizza Margarita')).toBeInTheDocument()
    expect(screen.queryByText('Limonada Natural')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Buscar producto'), 'zzz')
    expect(screen.getByText('Ningún producto coincide con la búsqueda.')).toBeInTheDocument()
  })

  it('sin categorias no deja crear productos y explica por que', async () => {
    catalogApi.listCategories.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText(/Primero crea una categoría/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agregar producto' })).toBeDisabled()
  })

  it('el interruptor de disponibilidad envia solo ese cambio y actualiza la fila', async () => {
    const user = userEvent.setup()
    catalogApi.setProductAvailability.mockResolvedValue({ ...PRODUCTS[0], isAvailable: false })
    renderPage()
    await user.click(await screen.findByRole('button', { name: /Pizza Margarita: disponible/ }))
    await waitFor(() => expect(catalogApi.setProductAvailability).toHaveBeenCalledWith('p1', false))
    expect(await screen.findByRole('button', { name: /Pizza Margarita: agotado/ })).toBeInTheDocument()
    expect(screen.getByText('Producto marcado como agotado')).toBeInTheDocument()
  })

  it('si falla el interruptor avisa y conserva el estado', async () => {
    const user = userEvent.setup()
    catalogApi.setProductAvailability.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'x'))
    renderPage()
    await user.click(await screen.findByRole('button', { name: /Pizza Margarita: disponible/ }))
    expect(await screen.findByText('No se pudo cambiar la disponibilidad')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Pizza Margarita: disponible/ })).toBeEnabled()
  })

  describe('crear', () => {
    const openForm = async (user) => {
      await screen.findByText('Pizza Margarita')
      await user.click(screen.getByRole('button', { name: 'Agregar producto' }))
      return screen.getByRole('dialog', { name: 'Agregar producto' })
    }

    it('exige nombre, precio, categoria y foto antes de enviar', async () => {
      const user = userEvent.setup()
      renderPage()
      const dialog = await openForm(user)
      await user.click(within(dialog).getByRole('button', { name: 'Crear producto' }))
      expect(within(dialog).getByText('El nombre es obligatorio')).toBeInTheDocument()
      expect(within(dialog).getByText('El precio es obligatorio')).toBeInTheDocument()
      // El mismo texto es la opcion vacia del selector y el mensaje de error
      expect(within(dialog).getAllByText('Selecciona una categoría')).toHaveLength(2)
      expect(within(dialog).getByText('La foto es obligatoria')).toBeInTheDocument()
      expect(catalogApi.createProduct).not.toHaveBeenCalled()
    })

    it('rechaza fotos que no son JPG/PNG/WebP o pesan mas de 2 MB', async () => {
      const user = userEvent.setup({ applyAccept: false })
      renderPage()
      const dialog = await openForm(user)
      const input = within(dialog).getByLabelText('Foto')

      await user.upload(input, photoFile('a.gif', 'image/gif'))
      expect(within(dialog).getByText('La foto debe ser JPG, PNG o WebP')).toBeInTheDocument()

      await user.upload(input, photoFile('grande.png', 'image/png', 3 * 1024 * 1024))
      expect(within(dialog).getByText('La foto no puede superar 2 MB')).toBeInTheDocument()
    })

    it('el precio solo admite enteros', async () => {
      const user = userEvent.setup()
      renderPage()
      const dialog = await openForm(user)
      await user.type(within(dialog).getByLabelText('Precio (COP)'), '28.5')
      await user.click(within(dialog).getByRole('button', { name: 'Crear producto' }))
      expect(within(dialog).getByText(/Debe ser un entero en COP/)).toBeInTheDocument()
    })

    it('envia multipart con todos los campos y agrega el producto', async () => {
      const user = userEvent.setup()
      const created = { ...PRODUCTS[0], productId: 'p3', name: 'Pizza Pepperoni', price: 32000 }
      catalogApi.createProduct.mockResolvedValue(created)
      renderPage()
      const dialog = await openForm(user)

      await user.type(within(dialog).getByLabelText('Nombre'), '  Pizza Pepperoni ')
      await user.type(within(dialog).getByLabelText('Descripción'), 'Pepperoni y queso')
      await user.type(within(dialog).getByLabelText('Precio (COP)'), '32000')
      await user.selectOptions(within(dialog).getByLabelText('Categoría'), 'c1')
      await user.upload(within(dialog).getByLabelText('Foto'), photoFile())
      await user.click(within(dialog).getByRole('button', { name: 'Crear producto' }))

      await waitFor(() => expect(catalogApi.createProduct).toHaveBeenCalledTimes(1))
      const form = catalogApi.createProduct.mock.calls[0][0]
      expect(form).toBeInstanceOf(FormData)
      expect(form.get('name')).toBe('Pizza Pepperoni')
      expect(form.get('description')).toBe('Pepperoni y queso')
      expect(form.get('price')).toBe('32000')
      expect(form.get('categoryId')).toBe('c1')
      expect(form.get('isAvailable')).toBe('true')
      expect(form.get('photo')).toBeInstanceOf(File)

      expect(await screen.findByText('Pizza Pepperoni')).toBeInTheDocument()
      expect(screen.getByText('Producto creado')).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('muestra el conflicto de nombre en el campo y deja el formulario abierto', async () => {
      const user = userEvent.setup()
      catalogApi.createProduct.mockRejectedValue(new ApiError(409, 'CONFLICT', 'x'))
      renderPage()
      const dialog = await openForm(user)
      await user.type(within(dialog).getByLabelText('Nombre'), 'Pizza Margarita')
      await user.type(within(dialog).getByLabelText('Precio (COP)'), '1000')
      await user.selectOptions(within(dialog).getByLabelText('Categoría'), 'c1')
      await user.upload(within(dialog).getByLabelText('Foto'), photoFile())
      await user.click(within(dialog).getByRole('button', { name: 'Crear producto' }))
      expect(
        await within(dialog).findByText('Ya existe un producto con ese nombre en la categoría'),
      ).toBeInTheDocument()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  describe('editar', () => {
    it('al abrir el formulario carga los datos y no permite guardar sin cambios', async () => {
      const user = userEvent.setup()
      renderPage()
      await user.click(await screen.findByRole('button', { name: 'Editar Pizza Margarita' }))
      const dialog = screen.getByRole('dialog', { name: 'Editar producto' })
      expect(within(dialog).getByLabelText('Nombre')).toHaveValue('Pizza Margarita')
      expect(within(dialog).getByLabelText('Precio (COP)')).toHaveValue('28000')
      expect(within(dialog).getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
    })

    it('al cambiar el precio envia solo el precio (la foto no es obligatoria)', async () => {
      const user = userEvent.setup()
      catalogApi.updateProduct.mockResolvedValue({ ...PRODUCTS[0], price: 30000 })
      renderPage()
      await user.click(await screen.findByRole('button', { name: 'Editar Pizza Margarita' }))
      const dialog = screen.getByRole('dialog', { name: 'Editar producto' })
      const price = within(dialog).getByLabelText('Precio (COP)')
      await user.clear(price)
      await user.type(price, '30000')
      await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }))

      await waitFor(() => expect(catalogApi.updateProduct).toHaveBeenCalledTimes(1))
      const [id, form] = catalogApi.updateProduct.mock.calls[0]
      expect(id).toBe('p1')
      expect([...form.keys()]).toEqual(['price'])
      expect(form.get('price')).toBe('30000')
      expect(await screen.findByText(/30\.000/)).toBeInTheDocument()
      expect(screen.getByText('Cambios guardados')).toBeInTheDocument()
    })
  })
})
