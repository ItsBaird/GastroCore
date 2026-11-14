import { useCallback, useEffect, useState } from 'react'
import { getCashClosePreview } from '../api/reports.js'
import { isValidDay, todayLocal } from '../utils/cashClose.js'

function errorMessage(err) {
  if (err?.status === 403) return 'No tienes permiso para ver el cierre de caja.'
  if (err?.status === 400) return 'La fecha seleccionada no es válida.'
  return 'No se pudo cargar la vista previa del cierre de caja.'
}

// Vista previa del cierre de caja de un dia (GC-RPT-0001). Arranca en hoy. Cambiar de fecha o reintentar vuelve a
// pedirla; si llega una respuesta vieja (se cambio de fecha mientras cargaba) se descarta.
export function useCashClosePreview() {
  const [date, setDateState] = useState(() => todayLocal())
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState({ status: 'loading', data: null, error: '' })

  useEffect(() => {
    let active = true
    getCashClosePreview(date)
      .then((data) => active && setResult({ status: 'ready', data, error: '' }))
      .catch((err) => active && setResult({ status: 'error', data: null, error: errorMessage(err) }))
    return () => {
      active = false
    }
  }, [date, attempt])

  const setDate = useCallback(
    (next) => {
      // El input date entrega '' si se borra: se ignora y queda la fecha anterior. La misma fecha tampoco hace
      // nada: el efecto no se repetiria y la pantalla se quedaria cargando.
      if (!isValidDay(next) || next === date) return
      setResult({ status: 'loading', data: null, error: '' })
      setDateState(next)
    },
    [date],
  )

  const reload = useCallback(() => {
    setResult({ status: 'loading', data: null, error: '' })
    setAttempt((n) => n + 1)
  }, [])

  return { date, setDate, reload, ...result }
}
