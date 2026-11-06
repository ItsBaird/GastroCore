import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as catalogApi from '../api/catalog.js'
import { ApiError } from '../api/errors.js'
import { AuthContext } from '../auth/authContext.js'
import { ToastProvider } from '../components/Toast.jsx'
import CategoriesPage from './CategoriesPage.jsx'

vi.mock('../api/catalog.js')

const ME = { userId: 'me', email: 'admin@lapizzeta.com', role: 'ADMIN', isActive: true }
const CATS = [
  { categoryId: 'c2', name: 'Bebidas', displayOrder: null },
  { categoryId: 'c1', name: 'Pizzas', displayOrder: 1 },
]
const PRODUCTS = [
  { productId: 'p1', categoryId: 'c1' },
  { productId: 'p2', categoryId: 'c1' },
  { productId: 'p3', categoryId: 'c2' },
]

function renderPage() {
  const auth = { status: 'authenticated', user: ME, login: vi.fn(), logout: vi.fn() }
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <CategoriesPage />
        </ToastProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  catalogApi.listCategories.mockResolvedValue(CATS)
  catalogApi.listProducts.mockResolvedValue(PRODUCTS)
})

describe('CategoriesPage', () => {
  it('lista las categorias en orden (sin orden al final) con su cantidad de productos', async () => {
    renderPage()
    expect(await screen.findByText('Pizzas')).toBeInTheDocument()
    const names = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(names).toEqual(['Pizzas', 'Bebidas'])
    expect(screen.getByText('2 productos')).toBeInTheDocument()
    expect(screen.getByText('1 producto')).toBeInTheDocument()
    expect(screen.getByText('Orden 1')).toBeInTheDocument()
  })

  it('si no cargan los productos igual muestra las categorias (sin conteo)', async () => {
    catalogApi.listProducts.mockRejectedValue(new Error('x'))
    renderPage()
    expect(await screen.findByText('Pizzas')).toBeInTheDocument()
    expect(screen.queryByText(/producto/)).not.toBeInTheDocument()
  })

  it('error al cargar -> alerta con reintento', async () => {
    catalogApi.listCategories.mockRejectedValueOnce(new Error('x'))
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar la lista de categorías')
    await user.click(screen.getByRole('button', { name: /Reintentar/ }))
    expect(await screen.findByText('Pizzas')).toBeInTheDocument()
  })

  it('sin categorias muestra el estado vacio', async () => {
    catalogApi.listCategories.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText(/Todavía no hay categorías/)).toBeInTheDocument()
  })

  it('crea una categoria con orden', async () => {
    const user = userEvent.setup()
    catalogApi.createCategory.mockResolvedValue({ categoryId: 'c3', name: 'Postres', displayOrder: 3 })
    renderPage()
    await screen.findByText('Pizzas')
    await user.click(screen.getByRole('button', { name: 'Nueva categoría' }))
    const dialog = screen.getByRole('dialog', { name: 'Nueva categoría' })
    await user.type(within(dialog).getByLabelText('Nombre'), ' Postres ')
    await user.type(within(dialog).getByLabelText('Orden en el menú'), '3')
    await user.click(within(dialog).getByRole('button', { name: 'Crear categoría' }))
    await waitFor(() =>
      expect(catalogApi.createCategory).toHaveBeenCalledWith({ name: 'Postres', displayOrder: 3 }),
    )
    expect(await screen.findByText('Postres')).toBeInTheDocument()
    expect(screen.getByText('Categoría creada')).toBeInTheDocument()
  })

  it('valida nombre vacio y orden no numerico', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Pizzas')
    await user.click(screen.getByRole('button', { name: 'Nueva categoría' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Orden en el menú'), 'uno')
    await user.click(within(dialog).getByRole('button', { name: 'Crear categoría' }))
    expect(within(dialog).getByText('El nombre es obligatorio')).toBeInTheDocument()
    expect(within(dialog).getByText(/número entero/)).toBeInTheDocument()
    expect(catalogApi.createCategory).not.toHaveBeenCalled()
  })

  it('nombre repetido -> mensaje en el campo', async () => {
    const user = userEvent.setup()
    catalogApi.createCategory.mockRejectedValue(new ApiError(409, 'CONFLICT', 'x'))
    renderPage()
    await screen.findByText('Pizzas')
    await user.click(screen.getByRole('button', { name: 'Nueva categoría' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Nombre'), 'Pizzas')
    await user.click(within(dialog).getByRole('button', { name: 'Crear categoría' }))
    expect(await within(dialog).findByText('Ya existe una categoría con ese nombre')).toBeInTheDocument()
  })

  it('edita el nombre y puede borrar el orden (null)', async () => {
    const user = userEvent.setup()
    catalogApi.updateCategory.mockResolvedValue({ categoryId: 'c1', name: 'Pizzas XL', displayOrder: null })
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Editar categoría Pizzas' }))
    const dialog = screen.getByRole('dialog', { name: 'Editar categoría' })
    expect(within(dialog).getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
    const name = within(dialog).getByLabelText('Nombre')
    await user.clear(name)
    await user.type(name, 'Pizzas XL')
    await user.clear(within(dialog).getByLabelText('Orden en el menú'))
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() =>
      expect(catalogApi.updateCategory).toHaveBeenCalledWith('c1', { name: 'Pizzas XL', displayOrder: null }),
    )
    expect(await screen.findByText('Pizzas XL')).toBeInTheDocument()
  })
})
