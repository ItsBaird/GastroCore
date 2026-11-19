import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PUBLIC_QR_SERVICES,
  resetWakeServices,
  SESSION_APP_SERVICES,
  WAKE_TIMEOUT_MS,
  wakeServices,
} from './wakeServices.js'

const ok = () => Promise.resolve(new Response('{"status":"ok"}', { status: 200 }))
const urls = (fetchImpl) => fetchImpl.mock.calls.map((c) => c[0])

beforeEach(() => {
  resetWakeServices()
})

describe('wakeServices', () => {
  it('la app con sesion despierta los 4 servicios por su /health', async () => {
    const fetchImpl = vi.fn(ok)
    await wakeServices(SESSION_APP_SERVICES, { fetchImpl })
    expect(urls(fetchImpl)).toEqual([
      '/api/auth/health',
      '/api/staff/health',
      '/api/catalog/health',
      '/api/orders/health',
    ])
  })

  it('la vista publica del QR solo despierta Catalog y Orders (lo que usa el cliente)', async () => {
    const fetchImpl = vi.fn(ok)
    await wakeServices(PUBLIC_QR_SERVICES, { fetchImpl })
    expect(urls(fetchImpl)).toEqual(['/api/catalog/health', '/api/orders/health'])
  })

  it('sin cookies ni cache, con un tiempo maximo de espera de 90 s', async () => {
    const fetchImpl = vi.fn(ok)
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    await wakeServices(['orders'], { fetchImpl })
    const [, options] = fetchImpl.mock.calls[0]
    expect(options).toMatchObject({ method: 'GET', cache: 'no-store', credentials: 'omit' })
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(timeout).toHaveBeenCalledWith(WAKE_TIMEOUT_MS)
    expect(WAKE_TIMEOUT_MS).toBe(90_000)
    timeout.mockRestore()
  })

  it('cada servicio se despierta una sola vez por carga de la pagina', async () => {
    const fetchImpl = vi.fn(ok)
    await wakeServices(PUBLIC_QR_SERVICES, { fetchImpl })
    await wakeServices(SESSION_APP_SERVICES, { fetchImpl })
    expect(urls(fetchImpl)).toEqual([
      '/api/catalog/health',
      '/api/orders/health',
      '/api/auth/health',
      '/api/staff/health',
    ])
  })

  it('si un servicio falla o no hay red, no lanza error ni frena a los demas', async () => {
    const fetchImpl = vi.fn((url) =>
      url.includes('staff') ? Promise.reject(new TypeError('Failed to fetch')) : ok(),
    )
    const results = await wakeServices(SESSION_APP_SERVICES, { fetchImpl })
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'fulfilled'])
  })

  it('no espera a nadie: devuelve enseguida aunque los servicios tarden en despertar', () => {
    const fetchImpl = vi.fn(() => new Promise(() => {}))
    const promise = wakeServices(SESSION_APP_SERVICES, { fetchImpl })
    expect(promise).toBeInstanceOf(Promise)
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })
})
