import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/errors.js'
import { AuthContext } from '../auth/authContext.js'
import LoginPage from './LoginPage.jsx'

function renderLogin({ auth = {}, state } = {}) {
  const value = {
    status: 'anonymous',
    user: null,
    expired: false,
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn(),
    ...auth,
  }
  render(
    <MemoryRouter initialEntries={[{ pathname: '/login', state }]}>
      <AuthContext.Provider value={value}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/admin/usuarios" element={<p>PANTALLA ADMIN</p>} />
          <Route path="/en-construccion" element={<p>EN CONSTRUCCION</p>} />
          <Route path="/otra-ruta" element={<p>OTRA RUTA</p>} />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
  return value
}

const fill = async (user, email, password) => {
  if (email) await user.type(screen.getByLabelText('Correo electrónico'), email)
  if (password) await user.type(screen.getByLabelText('Contraseña'), password)
}
const submit = (user) => user.click(screen.getByRole('button', { name: 'Iniciar Sesión' }))

describe('LoginPage', () => {
  it('muestra el formulario y la leyenda de roles', () => {
    renderLogin()
    expect(screen.getByRole('heading', { name: 'Iniciar Sesión' })).toBeInTheDocument()
    expect(screen.getByLabelText('Correo electrónico')).toHaveAttribute('type', 'email')
    expect(screen.getByLabelText('Contraseña')).toHaveAttribute('type', 'password')
    const roles = screen.getByRole('list', { name: 'Roles del sistema' })
    expect(roles).toHaveTextContent(/Administrador/)
    expect(roles).toHaveTextContent(/Mesero/)
    expect(roles).toHaveTextContent(/Cocinero/)
  })

  it('no envia nada si faltan campos y marca cuales', async () => {
    const user = userEvent.setup()
    const auth = renderLogin()
    await submit(user)
    expect(screen.getByText('Ingresa tu correo electrónico')).toBeInTheDocument()
    expect(screen.getByText('Ingresa tu contraseña')).toBeInTheDocument()
    expect(auth.login).not.toHaveBeenCalled()
  })

  it('envia el correo y la contraseña tal cual (la contraseña conserva sus espacios)', async () => {
    const user = userEvent.setup()
    const auth = renderLogin()
    await fill(user, 'mesero@lapizzeta.com', ' clave con espacios ')
    await submit(user)
    expect(auth.login).toHaveBeenCalledWith('mesero@lapizzeta.com', ' clave con espacios ')
  })

  it('bloquea el formulario mientras valida las credenciales', async () => {
    const user = userEvent.setup()
    let release
    const auth = renderLogin({ auth: { login: vi.fn(() => new Promise((r) => (release = r))) } })
    await fill(user, 'a@b.co', 'x')
    await submit(user)
    expect(screen.getByLabelText('Correo electrónico')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Iniciar Sesión' })).toBeDisabled()
    expect(auth.login).toHaveBeenCalledTimes(1)
    release()
  })

  it.each([
    [new ApiError(401, 'UNAUTHENTICATED', 'x'), 'Correo o contraseña incorrectos'],
    [new ApiError(423, 'ACCOUNT_LOCKED', 'x', { lockedUntil: '2026-10-27T15:30:00Z' }), 'Cuenta bloqueada temporalmente'],
    [new ApiError(429, 'RATE_LIMITED', 'x'), 'Demasiados intentos'],
    [new ApiError(0, 'NETWORK_ERROR', 'x'), 'No se pudo conectar con el servidor'],
  ])('muestra el mensaje adecuado ante %o', async (error, text) => {
    const user = userEvent.setup()
    renderLogin({ auth: { login: vi.fn().mockRejectedValue(error) } })
    await fill(user, 'a@b.co', 'x')
    await submit(user)
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
    // el formulario vuelve a quedar disponible para reintentar
    await waitFor(() => expect(screen.getByLabelText('Correo electrónico')).toBeEnabled())
  })

  it('el mensaje de credenciales no revela cual dato es incorrecto', async () => {
    const user = userEvent.setup()
    renderLogin({ auth: { login: vi.fn().mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'x')) } })
    await fill(user, 'a@b.co', 'x')
    await submit(user)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toMatch(/no existe|no encontrado/i)
    expect(alert).toHaveTextContent('Correo o contraseña incorrectos')
  })

  it('avisa cuando la sesion expiro', () => {
    renderLogin({ auth: { expired: true } })
    expect(screen.getByRole('alert')).toHaveTextContent('Tu sesión expiró')
  })

  it('permite ver y ocultar la contraseña', async () => {
    const user = userEvent.setup()
    renderLogin()
    const input = screen.getByLabelText('Contraseña')
    await user.click(screen.getByRole('button', { name: 'Mostrar contraseña' }))
    expect(input).toHaveAttribute('type', 'text')
    await user.click(screen.getByRole('button', { name: 'Ocultar contraseña' }))
    expect(input).toHaveAttribute('type', 'password')
  })

  it('no muestra el formulario mientras se recupera la sesion', () => {
    renderLogin({ auth: { status: 'checking' } })
    expect(screen.getByRole('status', { name: 'Cargando' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Correo electrónico')).not.toBeInTheDocument()
  })

  describe('con la sesion ya iniciada', () => {
    const session = (role) => ({ status: 'authenticated', user: { userId: 'u', email: 'a@b.co', role } })

    it('ADMIN va a la gestion de usuarios', () => {
      renderLogin({ auth: session('ADMIN') })
      expect(screen.getByText('PANTALLA ADMIN')).toBeInTheDocument()
    })

    it.each(['WAITER', 'COOK'])('%s va a la pantalla en construccion', (role) => {
      renderLogin({ auth: session(role) })
      expect(screen.getByText('EN CONSTRUCCION')).toBeInTheDocument()
    })

    it('vuelve a la ruta que se intentaba abrir', () => {
      renderLogin({ auth: session('ADMIN'), state: { from: '/otra-ruta' } })
      expect(screen.getByText('OTRA RUTA')).toBeInTheDocument()
    })
  })
})
