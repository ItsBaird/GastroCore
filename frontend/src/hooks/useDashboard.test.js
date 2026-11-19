import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/dashboard.js'
import { ApiError } from '../api/errors.js'
import { useDashboard } from './useDashboard.js'

vi.mock('../api/dashboard.js')

const data = (from) => ({ period: { from, to: from } })

beforeEach(() => {
  vi.resetAllMocks()
})

describe('useDashboard', () => {
  it('primera carga: loading -> ready con la semana en curso (sin rango)', async () => {
    api.getDashboard.mockResolvedValue(data('2026-11-16'))
    const { result } = renderHook(() => useDashboard())

    expect(result.current.status).toBe('loading')
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(api.getDashboard).toHaveBeenCalledWith({})
    expect(result.current.data.period.from).toBe('2026-11-16')
  })

  it('al cambiar de rango conserva los datos y marca refreshing; el mismo rango no repite la consulta', async () => {
    api.getDashboard.mockResolvedValueOnce(data('a'))
    let resolve
    api.getDashboard.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    const { result } = renderHook(() => useDashboard())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    act(() => result.current.setRange({ from: '2026-11-09', to: '2026-11-15' }))
    expect(result.current.refreshing).toBe(true)
    expect(result.current.data.period.from).toBe('a')

    await act(async () => resolve(data('b')))
    expect(result.current.refreshing).toBe(false)
    expect(result.current.data.period.from).toBe('b')

    act(() => result.current.setRange({ from: '2026-11-09', to: '2026-11-15' }))
    expect(api.getDashboard).toHaveBeenCalledTimes(2)
  })

  it('una respuesta vieja que llega tarde se descarta', async () => {
    let resolveOld
    api.getDashboard
      .mockReturnValueOnce(new Promise((r) => (resolveOld = r)))
      .mockResolvedValueOnce(data('nuevo'))
    const { result } = renderHook(() => useDashboard())

    act(() => result.current.setRange({ from: '2026-11-09', to: '2026-11-15' }))
    await waitFor(() => expect(result.current.data?.period.from).toBe('nuevo'))
    await act(async () => resolveOld(data('viejo')))

    expect(result.current.data.period.from).toBe('nuevo')
  })

  it('error sin datos: status error con mensaje; reintentar vuelve a pedir', async () => {
    api.getDashboard.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'x')).mockResolvedValueOnce(data('ok'))
    const { result } = renderHook(() => useDashboard())

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toBe('Sin conexión. Revisa la red e intenta de nuevo.')

    act(() => result.current.reload())
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.data.period.from).toBe('ok')
  })

  it('400 del servidor con datos ya en pantalla: los conserva y muestra el mensaje del campo', async () => {
    api.getDashboard
      .mockResolvedValueOnce(data('a'))
      .mockRejectedValueOnce(
        new ApiError(400, 'VALIDATION_ERROR', 'x', { fields: [{ path: 'to', message: 'El rango máximo es de 92 días' }] }),
      )
    const { result } = renderHook(() => useDashboard())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    act(() => result.current.setRange({ from: '2026-01-01', to: '2026-12-31' }))
    await waitFor(() => expect(result.current.error).toBe('El rango máximo es de 92 días'))
    expect(result.current.status).toBe('ready')
    expect(result.current.data.period.from).toBe('a')
  })
})
