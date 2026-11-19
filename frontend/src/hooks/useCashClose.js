import { useCallback, useEffect, useRef, useState } from 'react'
import { confirmCashClose, getCashClosePreview, getCashClosure } from '../api/reports.js'
import { isValidDay, todayLocal } from '../utils/cashClose.js'

function loadMessage(err) {
  if (err?.status === 403) return 'No tienes permiso para ver el cierre de caja.'
  if (err?.status === 400) return 'La fecha seleccionada no es válida.'
  return 'No se pudo cargar la vista previa del cierre de caja.'
}

function confirmMessage(err) {
  if (err?.code === 'DAY_CLOSED') return 'Ese día ya fue cerrado. Actualizamos la pantalla.'
  if (err?.status === 403) return 'No tienes permiso para cerrar la caja.'
  if (err?.status === 400) return 'Ese día todavía no se puede cerrar.'
  return 'No se pudo confirmar el cierre. Inténtalo de nuevo.'
}

// Cierre de caja de UN dia (GC-RPT-0001 y GC-RPT-0002). Primero pregunta si el dia ya esta cerrado (404 = abierto):
// si lo esta, muestra el consolidado CONFIRMADO tal como se guardo; si no, la vista previa en vivo. Arranca en hoy.
// Cambiar de fecha o reintentar vuelve a pedirlo; una respuesta vieja (se cambio de fecha mientras cargaba) se
// descarta. `confirm()` pide el cierre al servidor: el cliente solo envia la fecha.
export function useCashClose({ onClosed } = {}) {
  const [date, setDateState] = useState(() => todayLocal())
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState({ status: 'loading', closure: null, preview: null, error: '' })
  const [confirming, setConfirming] = useState(false)
  const dateRef = useRef(date)
  useEffect(() => {
    dateRef.current = date
  }, [date])

  useEffect(() => {
    let active = true
    async function load() {
      try {
        let closure = null
        try {
          closure = await getCashClosure(date)
        } catch (err) {
          if (err?.status !== 404) throw err
        }
        const preview = closure ? null : await getCashClosePreview(date)
        if (active) setResult({ status: 'ready', closure, preview, error: '' })
      } catch (err) {
        if (active) setResult({ status: 'error', closure: null, preview: null, error: loadMessage(err) })
      }
    }
    load()
    return () => {
      active = false
    }
  }, [date, attempt])

  const setDate = useCallback(
    (next) => {
      // El input date entrega '' si se borra: se ignora y queda la fecha anterior. La misma fecha tampoco hace
      // nada: el efecto no se repetiria y la pantalla se quedaria cargando.
      if (!isValidDay(next) || next === date) return
      setResult({ status: 'loading', closure: null, preview: null, error: '' })
      setDateState(next)
    },
    [date],
  )

  const reload = useCallback(() => {
    setResult({ status: 'loading', closure: null, preview: null, error: '' })
    setAttempt((n) => n + 1)
  }, [])

  // Devuelve { ok: true } o { ok: false, message }. Con DAY_CLOSED (otra persona ya cerro ese dia) recarga para
  // mostrar el cierre confirmado.
  const confirm = useCallback(async () => {
    const target = dateRef.current
    setConfirming(true)
    try {
      const closure = await confirmCashClose(target)
      if (dateRef.current === target) setResult({ status: 'ready', closure, preview: null, error: '' })
      onClosed?.(closure)
      return { ok: true }
    } catch (err) {
      if (err?.code === 'DAY_CLOSED') {
        reload()
        onClosed?.(null)
      }
      return { ok: false, message: confirmMessage(err), dayClosed: err?.code === 'DAY_CLOSED' }
    } finally {
      setConfirming(false)
    }
  }, [onClosed, reload])

  const closed = result.closure !== null
  return {
    date,
    setDate,
    reload,
    status: result.status,
    error: result.error,
    closure: result.closure,
    closed,
    // El consolidado que se muestra: el confirmado si el dia esta cerrado, si no la vista previa en vivo
    data: result.closure ?? result.preview,
    confirm,
    confirming,
  }
}
