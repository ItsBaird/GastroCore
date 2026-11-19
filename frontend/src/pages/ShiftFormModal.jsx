import { LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { Field } from '../components/Field.jsx'
import { Modal } from '../components/Modal.jsx'
import { mapShiftError, toIso, validateShift } from '../utils/shift.js'

// Programa un turno: empleado, dia y rango horario (hora de Colombia). El servidor lo crea 'programado'.
export function ShiftFormModal({ employees, presetDate = '', presetUserId = '', onSubmit, onClose }) {
  const [values, setValues] = useState({ userId: presetUserId, date: presetDate, start: '', end: '' })
  const [errors, setErrors] = useState({})
  const [general, setGeneral] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (key) => (event) => {
    setValues((current) => ({ ...current, [key]: event.target.value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setGeneral('')

    const found = validateShift(values)
    setErrors(found)
    if (Object.keys(found).length) return

    setBusy(true)
    try {
      await onSubmit({
        userId: values.userId,
        scheduledStart: toIso(values.date, values.start),
        scheduledEnd: toIso(values.date, values.end),
      })
    } catch (err) {
      const mapped = mapShiftError(err)
      setErrors(mapped.fields ?? {})
      setGeneral(mapped.general ?? '')
      setBusy(false)
    }
  }

  const formId = 'shift-form'

  return (
    <Modal
      title="Programar turno"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" form={formId} className="btn btn--primary" disabled={busy}>
            {busy && <LoaderCircle className="spin" size={16} />}
            Programar turno
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} noValidate className="catalog-form">
        {general && (
          <div className="alert" role="alert">
            {general}
          </div>
        )}

        <Field label="Empleado" error={errors.userId}>
          {(props) => (
            <select
              {...props}
              className="field__select"
              value={values.userId}
              onChange={set('userId')}
              disabled={busy}
            >
              <option value="">Selecciona un empleado</option>
              {employees.map((e) => (
                <option key={e.userId} value={e.userId}>
                  {e.fullName} · {e.position}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field label="Fecha" error={errors.date}>
          {(props) => (
            <input
              {...props}
              className="field__input"
              type="date"
              value={values.date}
              onChange={set('date')}
              disabled={busy}
            />
          )}
        </Field>

        <div className="catalog-form__row">
          <Field label="Hora de inicio" error={errors.start}>
            {(props) => (
              <input
                {...props}
                className="field__input"
                type="time"
                value={values.start}
                onChange={set('start')}
                disabled={busy}
              />
            )}
          </Field>
          <Field label="Hora de fin" error={errors.end}>
            {(props) => (
              <input
                {...props}
                className="field__input"
                type="time"
                value={values.end}
                onChange={set('end')}
                disabled={busy}
              />
            )}
          </Field>
        </div>
        <p className="field__hint">Horario en hora de Colombia. El turno nace como «Programado».</p>
      </form>
    </Modal>
  )
}
