import { LoaderCircle, RefreshCw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { endShift, listShifts, startShift } from '../api/staff.js'
import { useAuth } from '../auth/useAuth.js'
import {
  formatDayHeading,
  formatDuration,
  formatTime,
  dayKey,
  mondayOf,
  pickCurrentShift,
  shiftActionMessage,
  todayKey,
} from '../utils/shift.js'
import { ConfirmDialog } from './ConfirmDialog.jsx'
import { useToast } from './Toast.jsx'
import './MyShiftPanel.css'

const range = (s) => `${formatTime(s.scheduledStart)} – ${formatTime(s.scheduledEnd)}`

// Turno del usuario que inicio sesion: iniciar al llegar, finalizar al terminar. Los dos botones llaman
// al servidor, que es quien decide (hora dentro del rango, mesas abiertas). `hideWhenEmpty` oculta el
// panel si hoy no hay nada que mostrar (por ejemplo, arriba de la pantalla de turnos del admin).
export function MyShiftPanel({ hideWhenEmpty = false }) {
  const { user } = useAuth()
  const toast = useToast()
  const [{ status, shifts }, setData] = useState({ status: 'loading', shifts: [] })
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [confirmingEnd, setConfirmingEnd] = useState(false)
  const [reload, setReload] = useState(0)

  // Carga al abrir y al reintentar o cuando el servidor dice que el turno cambio
  useEffect(() => {
    let active = true
    listShifts({ week: mondayOf(todayKey()), userId: user.userId }).then(
      (list) => active && setData({ status: 'ready', shifts: list }),
      () => active && setData({ status: 'error', shifts: [] }),
    )
    return () => {
      active = false
    }
  }, [user.userId, reload])

  // La duracion del turno activo se actualiza sola cada medio minuto
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const refresh = useCallback(() => {
    setData((d) => ({ ...d, status: 'loading' }))
    setReload((n) => n + 1)
  }, [])

  const replace = (updated) =>
    setData((d) => ({ ...d, shifts: d.shifts.map((s) => (s.shiftId === updated.shiftId ? updated : s)) }))

  async function act(action, successText) {
    setBusy(true)
    setMessage('')
    try {
      replace(await action())
      setConfirmingEnd(false)
      toast.success(successText)
    } catch (err) {
      const { message: text, refresh: stale } = shiftActionMessage(err)
      setConfirmingEnd(false)
      setMessage(text)
      if (stale) refresh()
    } finally {
      setBusy(false)
    }
  }

  // En la pantalla de turnos del admin el panel es secundario: mientras carga o si falla, no estorba
  if (status === 'loading') {
    return hideWhenEmpty ? null : <div className="my-shift my-shift--skeleton" aria-hidden="true" />
  }

  if (status === 'error') {
    if (hideWhenEmpty) return null
    return (
      <div className="my-shift my-shift--state" role="alert">
        <TriangleAlert size={24} />
        <p>No se pudo cargar tu turno.</p>
        <button type="button" className="btn btn--ghost" onClick={refresh}>
          <RefreshCw size={16} /> Reintentar
        </button>
      </div>
    )
  }

  const { kind, shift } = pickCurrentShift(shifts, now)

  // Con hideWhenEmpty solo se muestra un turno que requiere accion hoy (programado o activo)
  if (hideWhenEmpty && !['programado', 'activo'].includes(kind)) return null

  if (kind === 'ninguno') {
    return (
      <section className="my-shift" aria-label="Mi turno">
        <p className="my-shift__title">Sin turnos programados</p>
        <p className="my-shift__meta">No tienes ningún turno programado esta semana.</p>
      </section>
    )
  }

  if (kind === 'proximo') {
    return (
      <section className="my-shift" aria-label="Mi turno">
        <p className="my-shift__title">Hoy no tienes turno</p>
        <p className="my-shift__meta">
          Tu próximo turno: {formatDayHeading(dayKey(shift.scheduledStart))}, {range(shift)}.
        </p>
      </section>
    )
  }

  if (kind === 'finalizado') {
    return (
      <section className="my-shift" aria-label="Mi turno">
        <p className="my-shift__title">Turno finalizado</p>
        <p className="my-shift__meta">
          Inicio: {formatTime(shift.actualStart)} — Fin: {formatTime(shift.actualEnd)} — Duración:{' '}
          {formatDuration(shift.actualStart, shift.actualEnd)}
        </p>
      </section>
    )
  }

  const isActive = kind === 'activo'
  return (
    <section className={`my-shift${isActive ? ' my-shift--active' : ''}`} aria-label="Mi turno">
      <div className="my-shift__row">
        <div className="my-shift__info">
          {isActive ? (
            <p className="my-shift__status">
              <span className="my-shift__dot" aria-hidden="true" />
              Turno activo
            </p>
          ) : (
            <p className="my-shift__title">Turno programado</p>
          )}
          {isActive ? (
            <p className="my-shift__meta">
              Inicio: {formatTime(shift.actualStart)} — Duración:{' '}
              {formatDuration(shift.actualStart, Math.max(now, new Date(shift.actualStart).getTime()))}
              <br />
              Programado: {range(shift)}
            </p>
          ) : (
            <p className="my-shift__meta">
              Hoy: {range(shift)} — {formatDuration(shift.scheduledStart, shift.scheduledEnd)}
            </p>
          )}
        </div>
        {isActive ? (
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => {
              setMessage('')
              setConfirmingEnd(true)
            }}
            disabled={busy}
          >
            Finalizar turno
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => act(() => startShift(shift.shiftId), 'Turno iniciado')}
            disabled={busy}
          >
            {busy && <LoaderCircle className="spin" size={16} />}
            Iniciar turno
          </button>
        )}
      </div>

      {message && (
        <div className="alert my-shift__alert" role="alert">
          {message}
        </div>
      )}

      {confirmingEnd && (
        <ConfirmDialog
          title="Finalizar turno"
          message="¿Finalizar tu turno? Si tienes mesas abiertas, el administrador debe reasignarlas antes."
          confirmLabel="Finalizar turno"
          busy={busy}
          onConfirm={() => act(() => endShift(shift.shiftId), 'Turno finalizado')}
          onCancel={() => setConfirmingEnd(false)}
        />
      )}
    </section>
  )
}
