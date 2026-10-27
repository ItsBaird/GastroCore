import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getAccessToken,
  getSnapshot,
  refreshSession,
  resetSessionForTests,
  setSession,
} from '../auth/session.js'
import { api } from './client.js'
import { ApiError } from './errors.js'

const json = (status, body) =>
  Promise.resolve(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

const session = (token) => ({ accessToken: token, user: { userId: 'u1', role: 'ADMIN', email: 'a@b.co' } })

let fetchMock
beforeEach(() => {
  resetSessionForTests()
  setSession(session('token-viejo'))
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('api()', () => {
  it('envia el access token en el header Authorization', async () => {
    fetchMock.mockImplementation(() => json(200, { ok: true }))
    await api('/api/auth/users')
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer token-viejo')
  })

  it('no envia Authorization cuando auth=false', async () => {
    fetchMock.mockImplementation(() => json(200, {}))
    await api('/api/auth/login', { method: 'POST', body: { a: 1 }, auth: false })
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined()
  })

  it('traduce el formato de error comun a ApiError', async () => {
    fetchMock.mockImplementation(() =>
      json(409, { error: { code: 'EMAIL_ALREADY_EXISTS', message: 'dup', details: {} } }),
    )
    const err = await api('/api/auth/register', { method: 'POST', body: {} }).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect([err.status, err.code]).toEqual([409, 'EMAIL_ALREADY_EXISTS'])
  })

  it('ante un 401 renueva la sesion una vez y reintenta con el token nuevo', async () => {
    fetchMock
      .mockImplementationOnce(() => json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }))
      .mockImplementationOnce(() => json(200, session('token-nuevo'))) // /refresh
      .mockImplementationOnce(() => json(200, [{ userId: 'u1' }]))

    const data = await api('/api/auth/users')

    expect(data).toEqual([{ userId: 'u1' }])
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/refresh')
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer token-nuevo')
    expect(getAccessToken()).toBe('token-nuevo')
  })

  it('varias peticiones que fallan a la vez comparten UNA sola renovacion', async () => {
    // El backend cierra todas las sesiones si un refresh token se usa dos veces
    let refreshCalls = 0
    fetchMock.mockImplementation((url, init) => {
      if (url === '/api/auth/refresh') {
        refreshCalls += 1
        return new Promise((resolve) => setTimeout(() => resolve(json(200, session('token-nuevo'))), 20))
      }
      return init.headers.Authorization === 'Bearer token-nuevo'
        ? json(200, { ok: true })
        : json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } })
    })

    await Promise.all([api('/api/a'), api('/api/b'), api('/api/c')])

    expect(refreshCalls).toBe(1)
  })

  it('si la renovacion es rechazada, la sesion expira', async () => {
    fetchMock
      .mockImplementationOnce(() => json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }))
      .mockImplementationOnce(() => json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }))

    await expect(api('/api/auth/users')).rejects.toMatchObject({ status: 401 })

    expect(getSnapshot()).toMatchObject({ status: 'anonymous', reason: 'expired', accessToken: null })
  })

  it('un fallo de red al renovar NO cierra la sesion', async () => {
    fetchMock
      .mockImplementationOnce(() => json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }))
      .mockImplementationOnce(() => Promise.reject(new TypeError('network')))

    await expect(api('/api/auth/users')).rejects.toBeInstanceOf(ApiError)
    expect(getSnapshot().status).toBe('authenticated')
  })

  it('no reintenta mas de una vez si el 401 persiste', async () => {
    fetchMock.mockImplementation((url) =>
      url === '/api/auth/refresh' ? json(200, session('t2')) : json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }),
    )
    await expect(api('/api/auth/users')).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(3) // peticion, refresh, reintento
  })
})

describe('refreshSession()', () => {
  it('envia la cookie (credentials) y guarda la sesion nueva', async () => {
    fetchMock.mockImplementation(() => json(200, session('t3')))
    await refreshSession()
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'same-origin' })
    expect(getSnapshot().user.role).toBe('ADMIN')
  })
})
