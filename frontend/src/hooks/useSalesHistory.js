import { useCallback, useEffect, useRef, useState } from 'react'
import { downloadSalesHistory, listSalesHistory } from '../api/history.js'
import {
  defaultHistoryFilters,
  HISTORY_PAGE_SIZE,
  historyRangeError,
  sameFilters,
  saveFile,
} from '../utils/salesHistory.js'

function loadMessage(err) {
  if (err?.status === 403) return 'No tienes permiso para ver el historial de ventas.'
  if (err?.status === 400) return err.details?.fields?.[0]?.message ?? 'Los filtros no son válidos.'
  if (err?.status === 0) return 'Sin conexión. Revisa la red e intenta de nuevo.'
  return 'No se pudo cargar el historial de ventas.'
}

function exportMessage(err) {
  if (err?.code === 'EXPORT_TOO_LARGE') {
    return `Son demasiadas ventas para un archivo (máximo ${err.details?.max ?? 10000}). Acota el rango de fechas o los filtros.`
  }
  if (err?.status === 403) return 'No tienes permiso para exportar el historial.'
  if (err?.status === 0) return 'Sin conexión. Revisa la red e intenta de nuevo.'
  return 'No se pudo generar el archivo de Excel.'
}

const EMPTY = { items: [], total: 0, summary: { totalSales: 0, ordersCount: 0, averageTicket: 0 } }

// GC-RPT-0003 (GC-192). Historial de ventas con filtros y paginacion.
//   - Arranca en HOY y pagina 1. Cambiar un filtro vuelve a la pagina 1 (criterio de la HU); los mismos filtros
//     no repiten la consulta.
//   - Un rango invalido (desde > hasta, mas de 366 dias) no se pide: queda en `filterError` y la pantalla lo muestra.
//   - Mientras llega la nueva pagina se conservan los datos anteriores (`refreshing`): sin parpadeo. Solo la primera
//     carga queda en 'loading'.
//   - client.js no acepta AbortSignal: una respuesta que llega tarde (se cambio de filtro o de pagina mientras
//     cargaba) se descarta por su numero de peticion; nunca se pinta un filtro que ya no es el pedido.
//   - `isEmpty`: ya cargo y el filtro no tiene ventas (estado vacio de la pantalla).
export function useSalesHistory({ now } = {}) {
  const [filters, setFiltersState] = useState(() => defaultHistoryFilters(now))
  const [page, setPageState] = useState(1)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ status: 'loading', data: null, error: '', refreshing: false })
  const [exporting, setExporting] = useState(false)
  const latest = useRef(0)
  const filterError = historyRangeError(filters)

  useEffect(() => {
    if (filterError) return
    const request = ++latest.current
    listSalesHistory(filters, { page, pageSize: HISTORY_PAGE_SIZE })
      .then((data) => {
        if (request === latest.current) setState({ status: 'ready', data, error: '', refreshing: false })
      })
      .catch((err) => {
        if (request !== latest.current) return
        setState({ status: 'error', data: null, error: loadMessage(err), refreshing: false })
      })
  }, [filters, filterError, page, attempt])

  const startRefresh = () =>
    setState((s) => ({ ...s, status: s.data ? 'ready' : 'loading', error: '', refreshing: Boolean(s.data) }))

  // Recibe solo lo que cambia ({ waiterId: '...' }). Cualquier cambio de filtro reinicia a la pagina 1.
  const setFilters = useCallback(
    (changes) => {
      const next = { ...filters, ...changes }
      if (sameFilters(next, filters)) return
      // Una respuesta en vuelo es de los filtros viejos: se invalida aunque el nuevo rango no se vaya a pedir
      latest.current += 1
      if (!historyRangeError(next)) startRefresh()
      setFiltersState(next)
      setPageState(1)
    },
    [filters],
  )

  const resetFilters = useCallback(() => setFilters(defaultHistoryFilters(now)), [setFilters, now])

  const setPage = useCallback(
    (next) => {
      if (next === page || next < 1) return
      startRefresh()
      setPageState(next)
    },
    [page],
  )

  const reload = useCallback(() => {
    startRefresh()
    setAttempt((n) => n + 1)
  }, [])

  // Descarga el Excel con los filtros ACTIVOS. Devuelve { ok: true } o { ok: false, message } para que la pantalla
  // avise (por ejemplo 422 EXPORT_TOO_LARGE) sin perder la tabla.
  const exportExcel = useCallback(async () => {
    if (historyRangeError(filters)) return { ok: false, message: historyRangeError(filters) }
    setExporting(true)
    try {
      const { blob, fileName } = await downloadSalesHistory(filters)
      saveFile(blob, fileName)
      return { ok: true, fileName }
    } catch (err) {
      return { ok: false, message: exportMessage(err) }
    } finally {
      setExporting(false)
    }
  }, [filters])

  const data = state.data ?? (state.status === 'error' ? null : EMPTY)
  const pageSize = state.data?.pageSize ?? HISTORY_PAGE_SIZE
  const total = state.data?.total ?? 0
  return {
    filters,
    setFilters,
    resetFilters,
    filterError,
    page,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    setPage,
    reload,
    status: state.status,
    error: state.error,
    refreshing: state.refreshing,
    data,
    isEmpty: state.status === 'ready' && total === 0,
    exportExcel,
    exporting,
  }
}
