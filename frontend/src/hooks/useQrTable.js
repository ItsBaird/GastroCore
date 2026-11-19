import { useCallback, useEffect, useRef, useState } from 'react'
import { getQrTable } from '../api/qr.js'

// GC-QR-0001. Estado de la mesa para la vista publica del QR. Sin sockets (exigen sesion): consulta
// GET /qr/:token cada 30 s solo con la pestana visible (decision de la PARADA 0: el limite publico es por IP
// y los clientes de un mismo Wi-Fi comparten IP). Ante errores espera mas cada vez; un 404 (QR invalido o
// mesa eliminada) detiene la consulta.
export const POLL_MS = 30_000
const MAX_BACKOFF_MS = 5 * 60_000

export function useQrTable(qrToken) {
  // phase: loading | ready | invalid | error
  const [state, setState] = useState({ phase: 'loading', table: null, error: null })
  const timer = useRef(null)
  const failures = useRef(0)
  const stopped = useRef(false)
  const inFlight = useRef(null)
  // La consulta se reprograma a si misma: se llama a traves de una ref para no capturarse al declararse
  const loadRef = useRef(() => {})

  const schedule = useCallback((fn, ms) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(fn, ms)
  }, [])

  const load = useCallback(async () => {
    if (stopped.current || document.visibilityState === 'hidden') return
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    try {
      const table = await getQrTable(qrToken, { signal: controller.signal })
      failures.current = 0
      setState({ phase: 'ready', table, error: null })
      schedule(() => loadRef.current(), POLL_MS)
    } catch (err) {
      if (controller.signal.aborted) return
      if (err?.status === 404) {
        stopped.current = true
        setState({ phase: 'invalid', table: null, error: err })
        return
      }
      failures.current += 1
      // Si ya se habia mostrado la mesa, se conserva y solo se reintenta mas tarde
      setState((prev) => ({ ...prev, phase: prev.table ? 'ready' : 'error', error: err }))
      schedule(() => loadRef.current(), Math.min(POLL_MS * 2 ** failures.current, MAX_BACKOFF_MS))
    }
  }, [qrToken, schedule])

  useEffect(() => {
    loadRef.current = load
  }, [load])

  const retry = useCallback(() => {
    failures.current = 0
    setState((prev) => ({ ...prev, phase: prev.table ? 'ready' : 'loading', error: null }))
    load()
  }, [load])

  useEffect(() => {
    stopped.current = false
    load()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        clearTimeout(timer.current)
        inFlight.current?.abort()
      } else {
        load()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopped.current = true
      clearTimeout(timer.current)
      inFlight.current?.abort()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [load])

  return { ...state, retry }
}
