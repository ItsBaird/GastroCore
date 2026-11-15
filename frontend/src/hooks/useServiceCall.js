import { useCallback, useEffect, useRef, useState } from 'react'

// GC-QR-0002 y GC-QR-0004. Estados de un aviso del cliente al mesero ("Llamar al mesero", "Pedir la cuenta").
// Los dos endpoints responden igual (201 PublicServiceCall, 409 CONFLICT si ya habia uno pendiente):
//   idle -> sending -> sent      (201: avisado; se queda asi un minuto para no repetir)
//                   -> already   (409 CONFLICT: ya habia uno pendiente; es informativo, no un error)
//                   -> stale     (409 TABLE_NOT_OPEN / INVALID_TRANSITION: la mesa cambio de estado; se vuelve
//                                 a consultar con onStale y `reason` guarda el codigo)
//                   -> limited   (429: demasiadas peticiones; se puede volver a intentar)
//                   -> failed    (red o 5xx: se ofrece reintentar)
// Un 404 (QR invalido o mesa eliminada) lo resuelve la pagina con onInvalid. Todo en memoria: nada en storage.
export const NOTIFIED_MS = 60_000

const STALE_CODES = new Set(['TABLE_NOT_OPEN', 'INVALID_TRANSITION'])

export function useServiceCall(send, qrToken, { onInvalid, onStale } = {}) {
  const [state, setState] = useState('idle')
  const [reason, setReason] = useState(null)
  const timer = useRef(null)
  const sending = useRef(false)

  useEffect(() => () => clearTimeout(timer.current), [])

  const backToIdleLater = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setState('idle')
      setReason(null)
    }, NOTIFIED_MS)
  }, [])

  const call = useCallback(async () => {
    if (sending.current) return // sin doble envio
    sending.current = true
    clearTimeout(timer.current)
    setReason(null)
    setState('sending')
    try {
      await send(qrToken)
      setState('sent')
      backToIdleLater()
    } catch (err) {
      if (err?.status === 409 && err.code === 'CONFLICT') {
        setState('already')
        backToIdleLater()
      } else if (err?.status === 409 && STALE_CODES.has(err.code)) {
        setReason(err.code)
        setState('stale')
        backToIdleLater()
        onStale?.()
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
  }, [send, qrToken, backToIdleLater, onInvalid, onStale])

  return { state, reason, call }
}
