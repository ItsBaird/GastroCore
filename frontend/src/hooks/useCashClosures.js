import { useCallback, useEffect, useState } from 'react'
import { listCashClosures } from '../api/reports.js'

export const CLOSURES_PAGE_SIZE = 10

function errorMessage(err) {
  if (err?.status === 403) return 'No tienes permiso para ver el historial de cierres.'
  return 'No se pudo cargar el historial de cierres.'
}

// Historial de cierres confirmados (GC-RPT-0002), del mas reciente al mas antiguo, paginado de a 10. Una respuesta
// vieja (se cambio de pagina mientras cargaba) se descarta. `reload` vuelve a pedir la pagina actual: se usa tras
// confirmar un cierre para que aparezca arriba.
export function useCashClosures() {
  const [page, setPageState] = useState(1)
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState({ status: 'loading', items: [], total: 0, error: '' })

  useEffect(() => {
    let active = true
    listCashClosures({ page, pageSize: CLOSURES_PAGE_SIZE })
      .then(
        (data) => active && setResult({ status: 'ready', items: data.items, total: data.total, error: '' }),
      )
      .catch((err) => active && setResult({ status: 'error', items: [], total: 0, error: errorMessage(err) }))
    return () => {
      active = false
    }
  }, [page, attempt])

  const setPage = useCallback((next) => {
    setResult((r) => ({ ...r, status: 'loading' }))
    setPageState(next)
  }, [])

  const reload = useCallback(() => {
    setResult((r) => ({ ...r, status: 'loading' }))
    setAttempt((n) => n + 1)
  }, [])

  const pages = Math.max(1, Math.ceil(result.total / CLOSURES_PAGE_SIZE))
  return { page, pages, setPage, reload, ...result }
}
