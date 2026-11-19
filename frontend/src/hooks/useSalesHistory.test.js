import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/errors.js'
import { useSalesHistory } from './useSalesHistory.js'

vi.mock('../api/history.js', () => ({
  listSalesHistory: vi.fn(),
  downloadSalesHistory: vi.fn(),
}))
vi.mock('../utils/salesHistory.js', async (original) => ({ ...(await original()), saveFile: vi.fn() }))

const api = await import('../api/history.js')
const utils = await import('../utils/salesHistory.js')

const NOW = new Date(2026, 10, 14, 23, 30) // 14-nov, 11:30 p. m. hora local
const TODAY = { from: '2026-11-14', to: '2026-11-14', waiterId: '', tableId: '', paymentMethodId: '' }
const page = ({ total = 2, page: p = 1, tag = 'a' } = {}) => ({
  items: total ? [{ orderId: `${tag}-1`, reference: 'AAAAAA' }] : [],
  page: p,
  pageSize: 20,
  total,
  summary: { totalSales: total * 1000, ordersCount: total, averageTicket: total ? 1000 : 0 },
})
const render = () => renderHook(() => useSalesHistory({ now: NOW }))

beforeEach(() => {
  vi.resetAllMocks()
  api.listSalesHistory.mockResolvedValue(page())
})

describe('useSalesHistory: carga, vacio y error (criterio de la tarea)', () => {
  it('primera carga: loading -> ready con HOY, pagina 1 de 20', async () => {
    const { result } = render()
    expect(result.current.status).toBe('loading')
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(api.listSalesHistory).toHaveBeenCalledWith(TODAY, { page: 1, pageSize: 20 })
    expect(result.current.data.total).toBe(2)
    expect(result.current.isEmpty).toBe(false)
    expect(result.current.filters).toEqual(TODAY)
  })

  it('vacio: ya cargo y el filtro no tiene ventas', async () => {
    api.listSalesHistory.mockResolvedValue(page({ total: 0 }))
    const { result } = render()
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.isEmpty).toBe(true)
    expect(result.current.data.items).toEqual([])
    expect(result.current.data.summary).toEqual({ totalSales: 0, ordersCount: 0, averageTicket: 0 })
  })

  it('mientras carga por primera vez no se considera vacio', () => {
    api.listSalesHistory.mockReturnValue(new Promise(() => {}))
    const { result } = render()
    expect(result.current.isEmpty).toBe(false)
  })

  it.each([
    [new ApiError(500, 'INTERNAL_ERROR', 'x'), 'No se pudo cargar el historial de ventas.'],
    [new ApiError(403, 'FORBIDDEN', 'x'), 'No tienes permiso para ver el historial de ventas.'],
    [new ApiError(0, 'NETWORK_ERROR', 'x'), 'Sin conexión. Revisa la red e intenta de nuevo.'],
    [
      new ApiError(400, 'VALIDATION_ERROR', 'x', { fields: [{ field: 'to', message: 'Rango muy largo' }] }),
      'Rango muy largo',
    ],
  ])('error %#: status error con mensaje para el usuario', async (err, message) => {
    api.listSalesHistory.mockRejectedValue(err)
    const { result } = render()
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toBe(message)
    expect(result.current.data).toBeNull()
    expect(result.current.isEmpty).toBe(false)
  })

  it('reload vuelve a pedir lo mismo y sale del error', async () => {
    api.listSalesHistory.mockRejectedValueOnce(new ApiError(500, 'X', 'x'))
    const { result } = render()
    await waitFor(() => expect(result.current.status).toBe('error'))
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(api.listSalesHistory).toHaveBeenCalledTimes(2)
    expect(api.listSalesHistory).toHaveBeenLastCalledWith(TODAY, { page: 1, pageSize: 20 })
  })
})

describe('useSalesHistory: filtros y paginacion', () => {
  it('cambiar un filtro vuelve a la pagina 1 y conserva los datos mientras llega lo nuevo', async () => {
    api.listSalesHistory.mockResolvedValue(page({ total: 45 }))
    const { result } = render()
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.setPage(3))
    await waitFor(() =>
      expect(api.listSalesHistory).toHaveBeenLastCalledWith(TODAY, { page: 3, pageSize: 20 }),
    )
    await waitFor(() => expect(result.current.refreshing).toBe(false))

    let resolve
    api.listSalesHistory.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    act(() => result.current.setFilters({ waiterId: 'w-1' }))

    expect(result.current.page).toBe(1)
    expect(result.current.refreshing).toBe(true)
    expect(result.current.data.total).toBe(45) // los datos anteriores siguen en pantalla
    expect(api.listSalesHistory).toHaveBeenLastCalledWith(
      { ...TODAY, waiterId: 'w-1' },
      { page: 1, pageSize: 20 },
    )

    await act(async () => resolve(page({ total: 1, tag: 'b' })))
    expect(result.current.refreshing).toBe(false)
    expect(result.current.data.items[0].orderId).toBe('b-1')
  })

  it('los mismos filtros no repiten la consulta', async () => {
    const { result } = render()
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.setFilters({ waiterId: '' }))
    expect(api.listSalesHistory).toHaveBeenCalledTimes(1)
  })

  it('pages se calcula con el total del filtro; setPage ignora la misma pagina y las menores a 1', async () => {
    api.listSalesHistory.mockResolvedValue(page({ total: 41 }))
    const { result } = render()
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.pages).toBe(3)
    act(() => result.current.setPage(1))
    act(() => result.current.setPage(0))
    expect(api.listSalesHistory).toHaveBeenCalledTimes(1)
  })

  it('un rango invalido NO se pide: queda en filterError y los datos anteriores siguen', async () => {
    const { result } = render()
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.setFilters({ from: '2026-11-20' })) // desde > hasta
    expect(result.current.filterError).toBe('La fecha desde no puede ser posterior a la fecha hasta.')
    expect(api.listSalesHistory).toHaveBeenCalledTimes(1)
    expect(result.current.data.total).toBe(2)

    act(() => result.current.setFilters({ to: '2026-11-25' })) // se corrige: ahora si se pide
    await waitFor(() => expect(api.listSalesHistory).toHaveBeenCalledTimes(2))
    expect(result.current.filterError).toBeNull()
  })

  it('resetFilters vuelve a HOY y sin filtros', async () => {
    const { result } = render()
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.setFilters({ from: '2026-11-01', tableId: 't-1' }))
    act(() => result.current.resetFilters())
    expect(result.current.filters).toEqual(TODAY)
  })
})

describe('useSalesHistory: respuestas obsoletas', () => {
  it('una respuesta que llega tarde (de otro filtro) no pisa a la nueva', async () => {
    let resolveOld
    api.listSalesHistory.mockReturnValueOnce(new Promise((r) => (resolveOld = r)))
    api.listSalesHistory.mockResolvedValueOnce(page({ total: 1, tag: 'nuevo' }))
    const { result } = render()

    act(() => result.current.setFilters({ tableId: 't-1' }))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.data.items[0].orderId).toBe('nuevo-1')

    await act(async () => resolveOld(page({ total: 9, tag: 'viejo' })))
    expect(result.current.data.items[0].orderId).toBe('nuevo-1')
    expect(result.current.data.total).toBe(1)
  })

  it('un error que llega tarde tampoco pisa los datos nuevos', async () => {
    let rejectOld
    api.listSalesHistory.mockReturnValueOnce(new Promise((_, r) => (rejectOld = r)))
    api.listSalesHistory.mockResolvedValueOnce(page({ total: 1, tag: 'nuevo' }))
    const { result } = render()
    act(() => result.current.setPage(2))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    await act(async () => rejectOld(new ApiError(500, 'X', 'x')))
    expect(result.current.status).toBe('ready')
    expect(result.current.error).toBe('')
  })
})

describe('useSalesHistory: exportar a Excel', () => {
  it('descarga con los filtros ACTIVOS y guarda el archivo con su nombre', async () => {
    const blob = new Blob(['PK'])
    api.downloadSalesHistory.mockResolvedValue({ blob, fileName: 'ventas_2026-11-14_2026-11-14.xlsx' })
    const { result } = render()
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.setFilters({ paymentMethodId: 'm-1' }))

    let out
    await act(async () => {
      out = await result.current.exportExcel()
    })
    expect(api.downloadSalesHistory).toHaveBeenCalledWith({ ...TODAY, paymentMethodId: 'm-1' })
    expect(utils.saveFile).toHaveBeenCalledWith(blob, 'ventas_2026-11-14_2026-11-14.xlsx')
    expect(out).toEqual({ ok: true, fileName: 'ventas_2026-11-14_2026-11-14.xlsx' })
    expect(result.current.exporting).toBe(false)
  })

  it('marca exporting mientras se genera', async () => {
    let resolve
    api.downloadSalesHistory.mockReturnValue(new Promise((r) => (resolve = r)))
    const { result } = render()
    await waitFor(() => expect(result.current.status).toBe('ready'))
    let pending
    act(() => {
      pending = result.current.exportExcel()
    })
    expect(result.current.exporting).toBe(true)
    await act(async () => {
      resolve({ blob: new Blob(['PK']), fileName: 'f.xlsx' })
      await pending
    })
    expect(result.current.exporting).toBe(false)
  })

  it('422 EXPORT_TOO_LARGE: mensaje para acotar el rango, sin tocar la tabla', async () => {
    api.downloadSalesHistory.mockRejectedValue(
      new ApiError(422, 'EXPORT_TOO_LARGE', 'x', { rows: 12000, max: 10000 }),
    )
    const { result } = render()
    await waitFor(() => expect(result.current.status).toBe('ready'))
    let out
    await act(async () => {
      out = await result.current.exportExcel()
    })
    expect(out).toEqual({
      ok: false,
      message:
        'Son demasiadas ventas para un archivo (máximo 10000). Acota el rango de fechas o los filtros.',
    })
    expect(utils.saveFile).not.toHaveBeenCalled()
    expect(result.current.status).toBe('ready')
  })

  it('otro error: mensaje generico', async () => {
    api.downloadSalesHistory.mockRejectedValue(new ApiError(500, 'X', 'x'))
    const { result } = render()
    await waitFor(() => expect(result.current.status).toBe('ready'))
    let out
    await act(async () => {
      out = await result.current.exportExcel()
    })
    expect(out.message).toBe('No se pudo generar el archivo de Excel.')
  })

  it('con un rango invalido no descarga y devuelve el motivo', async () => {
    const { result } = render()
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.setFilters({ from: '2026-11-20' }))
    let out
    await act(async () => {
      out = await result.current.exportExcel()
    })
    expect(out).toEqual({ ok: false, message: 'La fecha desde no puede ser posterior a la fecha hasta.' })
    expect(api.downloadSalesHistory).not.toHaveBeenCalled()
  })
})
