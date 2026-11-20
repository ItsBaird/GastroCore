import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../auth/authContext.js'
import { AdminLayout, AdminPage } from './AdminLayout.jsx'

const ME = { userId: 'me', email: 'admin@lapizzeta.com', role: 'ADMIN', isActive: true }

// Simula el ancho de la pantalla para (width <= 640px)
function setMobile(matches) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
}

function renderLayout(path = '/admin/mesas') {
  const auth = { status: 'authenticated', user: ME, login: vi.fn(), logout: vi.fn() }
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthContext.Provider value={auth}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="mesas" element={<AdminPage title="Gestión de Mesas">contenido mesas</AdminPage>} />
            <Route path="usuarios" element={<AdminPage title="Gestión de Usuarios">contenido usuarios</AdminPage>} />
          </Route>
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

const shell = () => document.querySelector('.shell')
const menu = () => document.getElementById('admin-menu')

afterEach(() => {
  delete window.matchMedia
  document.body.style.overflow = ''
})

describe('AdminLayout en movil: menu lateral con hamburguesa', () => {
  it('la barra superior tiene el boton de menu; el panel empieza cerrado y fuera del teclado', () => {
    setMobile(true)
    renderLayout()

    const button = screen.getByRole('button', { name: 'Abrir menú' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveAttribute('aria-controls', 'admin-menu')
    expect(shell()).not.toHaveClass('shell--menu-open')
    expect(menu()).toHaveAttribute('inert')
  })

  it('al abrir muestra todas las pantallas del ADMIN, es un dialogo modal y bloquea el fondo', async () => {
    setMobile(true)
    const user = userEvent.setup()
    renderLayout()

    await user.click(screen.getByRole('button', { name: 'Abrir menú' }))

    expect(shell()).toHaveClass('shell--menu-open')
    expect(menu()).not.toHaveAttribute('inert')
    expect(menu()).toHaveAttribute('role', 'dialog')
    expect(menu()).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('button', { name: 'Abrir menú' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Cerrar menú' })).toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')

    const links = within(menu()).getAllByRole('link').map((a) => a.textContent)
    expect(links).toEqual([
      'Dashboard',
      'Mesas',
      'Vista Mesero',
      'Productos',
      'Categorías',
      'Usuarios',
      'Empleados',
      'Turnos',
      'Ventas',
      'Cierre de Caja',
      'Métodos Pago',
    ])
    expect(within(menu()).getByRole('button', { name: 'Cerrar Sesión' })).toBeInTheDocument()
  })

  it('elegir una pantalla navega y cierra el panel', async () => {
    setMobile(true)
    const user = userEvent.setup()
    renderLayout()

    await user.click(screen.getByRole('button', { name: 'Abrir menú' }))
    await user.click(within(menu()).getByRole('link', { name: 'Usuarios' }))

    expect(screen.getByRole('heading', { name: 'Gestión de Usuarios' })).toBeInTheDocument()
    expect(shell()).not.toHaveClass('shell--menu-open')
    expect(document.body.style.overflow).toBe('')
  })

  it('Escape cierra y el foco vuelve al boton de menu', async () => {
    setMobile(true)
    const user = userEvent.setup()
    renderLayout()

    await user.click(screen.getByRole('button', { name: 'Abrir menú' }))
    await user.keyboard('{Escape}')

    expect(shell()).not.toHaveClass('shell--menu-open')
    expect(screen.getByRole('button', { name: 'Abrir menú' })).toHaveFocus()
  })

  it('el boton de cerrar y el fondo oscuro tambien cierran', async () => {
    setMobile(true)
    const user = userEvent.setup()
    renderLayout()

    await user.click(screen.getByRole('button', { name: 'Abrir menú' }))
    await user.click(screen.getByRole('button', { name: 'Cerrar menú' }))
    expect(shell()).not.toHaveClass('shell--menu-open')

    await user.click(screen.getByRole('button', { name: 'Abrir menú' }))
    await user.click(document.querySelector('.drawer-backdrop'))
    expect(shell()).not.toHaveClass('shell--menu-open')
  })

  it('el foco queda dentro del panel con Tab (dialogo modal)', async () => {
    setMobile(true)
    const user = userEvent.setup()
    renderLayout()

    await user.click(screen.getByRole('button', { name: 'Abrir menú' }))
    // Del ultimo (Cerrar Sesion) vuelve al primero (Cerrar menu)
    within(menu()).getByRole('button', { name: 'Cerrar Sesión' }).focus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Cerrar menú' })).toHaveFocus()
  })
})

describe('AdminLayout en escritorio y tablet', () => {
  it('sin hamburguesa: la barra lateral es la navegacion de siempre, no un dialogo', () => {
    setMobile(false)
    renderLayout()

    expect(screen.queryByRole('button', { name: 'Abrir menú' })).toBeNull()
    expect(menu()).not.toHaveAttribute('role')
    expect(menu()).not.toHaveAttribute('inert')
    expect(within(menu()).getByRole('link', { name: 'Dashboard' })).toBeInTheDocument()
  })
})
