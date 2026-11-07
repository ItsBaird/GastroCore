import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './client.js'
import { getMenu, mockMenuEnabled } from './menu.js'

vi.mock('./client.js', () => ({ api: vi.fn() }))

const failure = new Error('Catalog caido')

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('getMenu', () => {
  it('devuelve el menu real de Catalog', async () => {
    const menu = [{ categoryId: 'c1', name: 'Pizzas', products: [] }]
    api.mockResolvedValue(menu)

    await expect(getMenu()).resolves.toBe(menu)
    expect(api).toHaveBeenCalledWith('/api/catalog/public/menu')
  })

  it('en produccion un fallo de Catalog se propaga: nunca productos inventados', async () => {
    api.mockRejectedValue(failure)

    await expect(getMenu({ env: { DEV: false, VITE_USE_MOCK_MENU: 'true' } })).rejects.toBe(failure)
  })

  it('en desarrollo sin el flag tambien se propaga', async () => {
    api.mockRejectedValue(failure)

    await expect(getMenu({ env: { DEV: true } })).rejects.toBe(failure)
  })

  it('solo con DEV y VITE_USE_MOCK_MENU=true usa el menu de muestra y lo avisa', async () => {
    api.mockRejectedValue(failure)

    const menu = await getMenu({ env: { DEV: true, VITE_USE_MOCK_MENU: 'true' } })

    expect(menu.length).toBeGreaterThan(0)
    expect(console.warn).toHaveBeenCalled()
  })

  it.each([
    [{ DEV: true, VITE_USE_MOCK_MENU: 'true' }, true],
    [{ DEV: true, VITE_USE_MOCK_MENU: '1' }, false],
    [{ DEV: false, VITE_USE_MOCK_MENU: 'true' }, false],
    [{}, false],
  ])('mockMenuEnabled(%o) = %s', (env, expected) => {
    expect(mockMenuEnabled(env)).toBe(expected)
  })
})
