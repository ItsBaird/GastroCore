import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callWaiter, getPublicMenu, getQrTable, QrApiError, sendOrderRequest } from './qr.js'

const json = (status, body) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

let fetchSpy
beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch')
})
afterEach(() => {
  fetchSpy.mockRestore()
})

describe('cliente HTTP público del QR', () => {
  it('nunca envía cookies ni Authorization y no toca /api/auth', async () => {
    fetchSpy.mockImplementation(() => json(200, {}))

    await getQrTable('abc')
    await getPublicMenu()
    await callWaiter('abc')

    for (const [url, options] of fetchSpy.mock.calls) {
      expect(url).not.toMatch(/\/api\/auth/)
      expect(options.credentials).toBe('omit')
      expect(options.headers).not.toHaveProperty('Authorization')
    }
    expect(fetchSpy.mock.calls.map(([url, o]) => `${o.method} ${url}`)).toEqual([
      'GET /api/orders/qr/abc',
      'GET /api/catalog/public/menu',
      'POST /api/orders/qr/abc/call',
    ])
  })

  it('el token va codificado en la ruta', async () => {
    fetchSpy.mockImplementation(() => json(200, {}))
    await getQrTable('a/b?c')
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/orders/qr/a%2Fb%3Fc')
  })

  it('traduce errores del contrato y la falta de red', async () => {
    fetchSpy.mockImplementationOnce(() => json(404, { error: { code: 'NOT_FOUND', message: 'Mesa no encontrada' } }))
    await expect(getQrTable('x')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' })

    fetchSpy.mockImplementationOnce(() => Promise.resolve(new Response('<html>502</html>', { status: 502 })))
    await expect(getQrTable('x')).rejects.toMatchObject({ status: 502, code: 'UNKNOWN' })

    fetchSpy.mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')))
    const err = await getQrTable('x').catch((e) => e)
    expect(err).toBeInstanceOf(QrApiError)
    expect(err).toMatchObject({ status: 0, code: 'NETWORK_ERROR' })
  })
})

describe('sendOrderRequest', () => {
  it('envía solo productId, quantity y note (R4), sin cookies', async () => {
    fetchSpy.mockImplementation(() => json(201, { qrRequestId: 'q1' }))
    await sendOrderRequest('abc', [
      { key: 'k1', productId: 'p1', name: 'Pizza', price: 22000, quantity: 2, note: '  sin cebolla ', problem: null },
      { key: 'k2', productId: 'p2', name: 'Agua', price: 2000, quantity: 1, note: '' },
    ])
    const [url, options] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/orders/qr/abc/request')
    expect(options.method).toBe('POST')
    expect(options.credentials).toBe('omit')
    expect(JSON.parse(options.body)).toEqual({
      items: [
        { productId: 'p1', quantity: 2, note: 'sin cebolla' },
        { productId: 'p2', quantity: 1 },
      ],
    })
    expect(options.body).not.toMatch(/price|total|name/)
  })

  it('los errores conservan details', async () => {
    fetchSpy.mockImplementation(() => json(409, { error: { code: 'CONFLICT', message: 'x', details: { pending: 3 } } }))
    await expect(sendOrderRequest('abc', [])).rejects.toMatchObject({ status: 409, details: { pending: 3 } })
  })
})
