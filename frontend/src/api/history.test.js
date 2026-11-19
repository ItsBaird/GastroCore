import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './errors.js'

vi.mock('../auth/session.js', () => ({
  getAccessToken: vi.fn(),
  refreshSession: vi.fn(),
  expireSession: vi.fn(),
}))
vi.mock('./client.js', () => ({ api: vi.fn() }))

const session = await import('../auth/session.js')
const { api } = await import('./client.js')
const { downloadSalesHistory, fileNameFrom, getSalesHistoryOrder, historyQuery, listSalesHistory } =
  await import('./history.js')

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const fileResponse = (name = 'ventas_2026-11-01_2026-11-14.xlsx') =>
  new Response('PK', {
    status: 200,
    headers: { 'Content-Type': XLSX, 'Content-Disposition': `attachment; filename="${name}"` },
  })
const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  vi.resetAllMocks()
  session.getAccessToken.mockReturnValue('token-1')
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('historyQuery', () => {
  it('solo manda los filtros con valor; "todos" (\'\') no viaja', () => {
    expect(
      historyQuery({
        from: '2026-11-01',
        to: '2026-11-14',
        waiterId: '',
        tableId: 't-1',
        paymentMethodId: '',
      }),
    ).toBe('?from=2026-11-01&to=2026-11-14&tableId=t-1')
  })

  it('from y to van juntos: con uno solo no manda ninguno', () => {
    expect(historyQuery({ from: '2026-11-01' })).toBe('')
  })

  it('agrega la paginacion', () => {
    expect(historyQuery({ from: 'a', to: 'b' }, { page: 2, pageSize: 20 })).toBe(
      '?from=a&to=b&page=2&pageSize=20',
    )
  })

  it('sin nada no agrega "?"', () => {
    expect(historyQuery()).toBe('')
  })
})

describe('listado y detalle (por el cliente comun)', () => {
  it('listSalesHistory pide /history con filtros y pagina', async () => {
    api.mockResolvedValue({ items: [] })
    await listSalesHistory({ from: '2026-11-14', to: '2026-11-14', waiterId: 'w' }, { page: 3, pageSize: 20 })
    expect(api).toHaveBeenCalledWith(
      '/api/orders/history?from=2026-11-14&to=2026-11-14&waiterId=w&page=3&pageSize=20',
    )
  })

  it('getSalesHistoryOrder pide el detalle por id', async () => {
    api.mockResolvedValue({})
    await getSalesHistoryOrder('3f9a1c7e-0b2d-4e5f-8a9b-1c2d3e4f5a6b')
    expect(api).toHaveBeenCalledWith('/api/orders/history/3f9a1c7e-0b2d-4e5f-8a9b-1c2d3e4f5a6b')
  })
})

describe('downloadSalesHistory (blob con token)', () => {
  const filters = { from: '2026-11-01', to: '2026-11-14', paymentMethodId: 'm-1' }

  it('pide /history/export con el token y los filtros (sin paginar) y devuelve el blob con su nombre', async () => {
    fetch.mockResolvedValue(fileResponse())
    const out = await downloadSalesHistory(filters)

    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/orders/history/export?from=2026-11-01&to=2026-11-14&paymentMethodId=m-1')
    expect(init.headers).toEqual({ Authorization: 'Bearer token-1' })
    expect(init.credentials).toBe('same-origin')
    expect(out.fileName).toBe('ventas_2026-11-01_2026-11-14.xlsx')
    // jsdom y Node tienen clases Blob distintas: se comprueba el contenido, no la clase
    expect(out.blob.size).toBe(2)
    expect(out.blob.type).toBe(XLSX)
  })

  it('401: renueva la sesion UNA vez y reintenta con el token nuevo', async () => {
    fetch.mockResolvedValueOnce(jsonResponse(401, { error: { code: 'UNAUTHENTICATED' } }))
    fetch.mockResolvedValueOnce(fileResponse())
    session.refreshSession.mockImplementation(async () => session.getAccessToken.mockReturnValue('token-2'))

    const out = await downloadSalesHistory(filters)
    expect(session.refreshSession).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1][1].headers).toEqual({ Authorization: 'Bearer token-2' })
    expect(out.blob.size).toBe(2)
  })

  it('si la renovacion es rechazada (401) la sesion expira y el error sube', async () => {
    fetch.mockResolvedValue(jsonResponse(401, {}))
    session.refreshSession.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'x'))
    await expect(downloadSalesHistory(filters)).rejects.toMatchObject({ status: 401 })
    expect(session.expireSession).toHaveBeenCalled()
  })

  it('422 EXPORT_TOO_LARGE llega como ApiError con su codigo y detalles', async () => {
    fetch.mockResolvedValue(
      jsonResponse(422, {
        error: { code: 'EXPORT_TOO_LARGE', message: 'm', details: { rows: 12000, max: 10000 } },
      }),
    )
    await expect(downloadSalesHistory(filters)).rejects.toMatchObject({
      status: 422,
      code: 'EXPORT_TOO_LARGE',
      details: { rows: 12000, max: 10000 },
    })
  })

  it('sin red -> ApiError NETWORK_ERROR (status 0)', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(downloadSalesHistory(filters)).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' })
  })

  it('sin Content-Disposition usa el nombre del rango', async () => {
    fetch.mockResolvedValue(new Response('PK', { status: 200 }))
    expect((await downloadSalesHistory(filters)).fileName).toBe('ventas_2026-11-01_2026-11-14.xlsx')
  })
})

describe('fileNameFrom', () => {
  it.each([
    ['attachment; filename="ventas_a_b.xlsx"', 'ventas_a_b.xlsx'],
    ['attachment; filename=ventas_a_b.xlsx', 'ventas_a_b.xlsx'],
    [null, 'otro.xlsx'],
    ['attachment', 'otro.xlsx'],
  ])('%s -> %s', (header, expected) => {
    expect(fileNameFrom(header, 'otro.xlsx')).toBe(expected)
  })
})
