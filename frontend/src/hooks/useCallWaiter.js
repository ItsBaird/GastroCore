import { useCallback, useEffect, useRef, useState } from 'react'
import { callWaiter } from '../api/qr.js'

// GC-QR-0002. Estados del boton "Llamar al mesero" (la sala a la que llega el aviso la decide el servidor):
//   idle -> sending -> sent      (201: avisado; se queda asi un minuto para no llamar de nuevo)
//                   -> already   (409 CONFLICT: ya habia un llamado pendiente; es informativo, no un error)
//                   -> limited   (429: demasiadas peticiones; se puede volver a intentar)
//                   -> failed    (red o 5xx: se ofrece reintentar)
// Un 404 (QR invalido o mesa eliminada) lo resuelve la pagina con onInvalid. Todo en memoria: nada en storage.
export const NOTIFIED_MS = 60_000

export function useCallWaiter(qrToken, { onInvalid } = {}) {
  const [state, setState] = useState('idle')
  const timer = useRef(null)
  const sending = useRef(false)

  useEffect(() => () => clearTimeout(timer.current), [])

  const backToIdleLater = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), NOTIFIED_MS)
  }, [])

  const call = useCallback(async () => {
    if (sending.current) return // sin doble envio
    sending.current = true
    setState('sending')
    try {
      await callWaiter(qrToken)
      setState('sent')
      backToIdleLater()
    } catch (err) {
      if (err?.status === 409 && err.code === 'CONFLICT') {
        setState('already')
        backToIdleLater()
      } else if (err?.status === 404) {
        setState('idle')
        onInvalid?.()
      } else if (err?.status === 429) {
        setState('limited')
      } else {
        setState('failed')
      }
    } finally {
      sending.current = false
    }
  }, [qrToken, backToIdleLater, onInvalid])

  return { state, call }
}
