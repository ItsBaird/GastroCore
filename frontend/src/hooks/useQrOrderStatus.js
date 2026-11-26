import { useCallback, useEffect, useRef, useState } from 'react'
import { getQrOrderStatus } from '../api/qr.js'

// Estado del pedido del cliente del QR (GET /qr/:token/order). Solo consulta mientras la hoja "Estado" esta
// abierta y la pestana visible: al abrir y luego cada 20 s. El limite publico es por IP y los clientes de un
// mismo Wi-Fi la comparten, asi que no se consulta en segundo plano. Un error conserva lo ultimo que se mostro.
export const STATUS_POLL_MS = 20_000

export function useQrOrderStatus(qrToken, open) {
  // phase: idle (aun sin respuesta: se muestra como cargando) | loading | ready | error
  const [state, setState] = useState({ phase: 'idle', data: null, error: null })
  const timer = useRef(null)
  const inFlight = useRef(null)
  const loadRef = useRef(() => {})

  const load = useCallback(async () => {
    clearTimeout(timer.current)
    if (document.visibilityState === 'hidden') return
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    try {
      const data = await getQrOrderStatus(qrToken, { signal: controller.signal })
      setState({ phase: 'ready', data, error: null })
    } catch (err) {
      if (controller.signal.aborted) return
      setState((prev) => ({ ...prev, phase: prev.data ? 'ready' : 'error', error: err }))
    }
    timer.current = setTimeout(() => loadRef.current(), STATUS_POLL_MS)
  }, [qrToken])

  useEffect(() => {
    loadRef.current = load
  }, [load])

  useEffect(() => {
    if (!open) return undefined
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
      clearTimeout(timer.current)
      inFlight.current?.abort()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [open, load])

  const retry = useCallback(() => {
    setState((prev) => (prev.data ? prev : { phase: 'loading', data: null, error: null }))
    load()
  }, [load])

  return { ...state, retry }
}
