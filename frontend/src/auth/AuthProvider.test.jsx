import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from './AuthProvider.jsx'
import { resetSessionForTests } from './session.js'
import { useAuth } from './useAuth.js'

const json = (status, body) =>
  Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status }))

const SESSION = { accessToken: 't1', user: { userId: 'u1', email: 'a@b.co', role: 'ADMIN', permissions: [] } }

let auth
function Probe() {
  auth = useAuth()
  return (
    <p>
      {auth.status}:{auth.user?.role ?? '-'}:{auth.expired ? 'expired' : 'ok'}
    </p>
  )
}

const mount = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  )

let fetchMock
beforeEach(() => {
  resetSessionForTests()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('AuthProvider', () => {
  it('al abrir la app recupera la sesion con la cookie del refresh token', async () => {
    fetchMock.mockImplementation(() => json(200, SESSION))
    mount()
    expect(screen.getByText('checking:-:ok')).toBeInTheDocument()
    expect(await screen.findByText('authenticated:ADMIN:ok')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/refresh')
  })

  it('sin cookie valida queda anonimo (sin mensaje de sesion expirada)', async () => {
    fetchMock.mockImplementation(() => json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }))
    mount()
    expect(await screen.findByText('anonymous:-:ok')).toBeInTheDocument()
  })

  it('StrictMode no dispara dos renovaciones (el backend revocaria las sesiones)', async () => {
    fetchMock.mockImplementation(() => json(200, SESSION))
    const { StrictMode } = await import('react')
    render(
      <StrictMode>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </StrictMode>,
    )
    await screen.findByText('authenticated:ADMIN:ok')
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/auth/refresh')).toHaveLength(1)
  })

  it('login guarda la sesion y expone el usuario', async () => {
    fetchMock
      .mockImplementationOnce(() => json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } })) // arranque
      .mockImplementationOnce(() => json(200, SESSION)) // login
    mount()
    await screen.findByText('anonymous:-:ok')

    await act(() => auth.login('a@b.co', 'clave'))

    expect(await screen.findByText('authenticated:ADMIN:ok')).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('/api/auth/login')
    expect(JSON.parse(init.body)).toEqual({ email: 'a@b.co', password: 'clave' })
    expect(init.headers.Authorization).toBeUndefined() // el login no envia token
  })

  it('un login rechazado lanza el error y no inicia sesion', async () => {
    fetchMock
      .mockImplementationOnce(() => json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }))
      .mockImplementationOnce(() => json(401, { error: { code: 'UNAUTHENTICATED', message: 'Credenciales' } }))
    mount()
    await screen.findByText('anonymous:-:ok')

    await expect(auth.login('a@b.co', 'mala')).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' })
    expect(screen.getByText('anonymous:-:ok')).toBeInTheDocument()
  })

  it('logout revoca el token en el servidor y cierra la sesion local', async () => {
    fetchMock.mockImplementation((url) => (url === '/api/auth/logout' ? json(204) : json(200, SESSION)))
    mount()
    await screen.findByText('authenticated:ADMIN:ok')

    await act(() => auth.logout())

    expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/auth/logout' && init.method === 'POST')).toBe(true)
    expect(await screen.findByText('anonymous:-:ok')).toBeInTheDocument()
  })

  it('logout cierra la sesion local aunque falle la red', async () => {
    fetchMock.mockImplementation((url) => (url === '/api/auth/logout' ? Promise.reject(new TypeError('red')) : json(200, SESSION)))
    mount()
    await screen.findByText('authenticated:ADMIN:ok')

    await act(() => auth.logout())

    await waitFor(() => expect(screen.getByText('anonymous:-:ok')).toBeInTheDocument())
  })
})
