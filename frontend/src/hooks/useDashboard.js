import { useCallback, useEffect, useRef, useState } from 'react'
import { getDashboard } from '../api/dashboard.js'

function errorMessage(err) {
  if (err?.status === 403) return 'No tienes permiso para ver el dashboard.'
  if (err?.status === 400) {
    return err.details?.fields?.[0]?.message ?? 'El periodo seleccionado no es válido.'
  }
  if (err?.status === 0) return 'Sin conexión. Revisa la red e intenta de nuevo.'
  return 'No se pudieron cargar las métricas.'
}

// GC-RPT-0004. Datos del dashboard para un rango ({ from, to } o {} = semana en curso).
//   - Al cambiar de rango se conservan los datos anteriores en pantalla (`refreshing`) hasta que llegan los nuevos:
//     sin parpadeo. Solo la primera carga muestra el esqueleto.
//   - El cliente HTTP del proyecto (client.js, protegido) no acepta AbortSignal: una respuesta que llega tarde
//     (se cambio de rango mientras cargaba) se descarta por su numero de peticion. El efecto es el mismo para el
//     usuario: nunca se pinta un rango que ya no es el pedido.
export function useDashboard(initialRange = {}) {
  const [range, setRangeState] = useState(initialRange)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ status: 'loading', data: null, error: '', refreshing: false })
  const latest = useRef(0)
  const current = useRef(initialRange)

  useEffect(() => {
    const request = ++latest.current
    getDashboard(range)
      .then((data) => {
        if (request === latest.current) setState({ status: 'ready', data, error: '', refreshing: false })
      })
      .catch((err) => {
        if (request !== latest.current) return
        setState((prev) => ({
          status: prev.data ? 'ready' : 'error',
          data: prev.data,
          error: errorMessage(err),
          refreshing: false,
        }))
      })
  }, [range, attempt])

  // Mismo rango: no se repite la consulta (el efecto no volveria a correr y se quedaria "actualizando")
  const setRange = useCallback((next) => {
    if (current.current.from === next.from && current.current.to === next.to) return
    current.current = next
    setState((s) => ({ ...s, error: '', refreshing: Boolean(s.data) }))
    setRangeState(next)
  }, [])

  const reload = useCallback(() => {
    setState((s) => ({ ...s, status: s.data ? 'ready' : 'loading', error: '', refreshing: Boolean(s.data) }))
    setAttempt((n) => n + 1)
  }, [])

  return { range, setRange, reload, ...state }
}
