import { LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { ApiError } from '../api/errors.js'
import { Field } from '../components/Field.jsx'
import { Modal } from '../components/Modal.jsx'

// Mismas reglas que el backend (zod): el servidor siempre vuelve a validar
function validate(tableNumber) {
  if (!tableNumber.trim()) return 'El número de mesa es obligatorio'
  const num = Number(tableNumber)
  if (!Number.isInteger(num) || num < 1) return 'Debe ser un número entero positivo'
  return undefined
}

// Traduce el error de la API a un mensaje en el campo
function mapApiError(err) {
  if (!(err instanceof ApiError)) return { general: 'No se pudo completar la acción.' }
  if (err.code === 'CONFLICT') return { field: 'Ya existe una mesa con ese número' }
  if (err.code === 'VALIDATION_ERROR' && err.details?.fields?.length) {
    return { field: err.details.fields[0].message }
  }
  if (err.code === 'NOT_FOUND') return { general: 'Esta mesa ya no existe.' }
  if (err.code === 'FORBIDDEN') return { general: err.message }
  if (err.code === 'NETWORK_ERROR') return { general: 'No se pudo conectar con el servidor.' }
  return { general: 'No se pudo completar la acción. Inténtalo de nuevo.' }
}

// mode "create": solo numero de mesa (el qrToken lo genera el servidor).
// mode "edit": igual, el qrToken nunca se envia ni se muestra editable (GC-ADM-0002).
export function TableFormModal({ mode, table, onSubmit, onClose }) {
  const isEdit = mode === 'edit'
  const [tableNumber, setTableNumber] = useState(isEdit ? String(table.tableNumber) : '')
  const [error, setError] = useState('')
  const [general, setGeneral] = useState('')
  const [busy, setBusy] = useState(false)

  const unchanged = isEdit && Number(tableNumber) === table.tableNumber

  const handleSubmit = async (event) => {
    event.preventDefault()
    setGeneral('')

    const found = validate(tableNumber)
    setError(found)
    if (found) return

    setBusy(true)
    try {
      await onSubmit({ tableNumber: Number(tableNumber) })
    } catch (err) {
      const mapped = mapApiError(err)
      setError(mapped.field ?? '')
      setGeneral(mapped.general ?? '')
      setBusy(false)
    }
  }

  const formId = 'table-form'

  return (
    <Modal
      title={isEdit ? 'Editar mesa' : 'Nueva mesa'}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" form={formId} className="btn btn--primary" disabled={busy || unchanged}>
            {busy && <LoaderCircle className="spin" size={16} />}
            {isEdit ? 'Guardar cambios' : 'Crear mesa'}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} noValidate className="table-form">
        {general && (
          <div className="alert" role="alert">
            {general}
          </div>
        )}

        <Field label="Número de mesa" error={error}>
          {(props) => (
            <input
              {...props}
              className="field__input"
              type="number"
              min="1"
              step="1"
              value={tableNumber}
              onChange={(event) => {
                setTableNumber(event.target.value)
                setError(undefined)
              }}
              disabled={busy}
            />
          )}
        </Field>
      </form>
    </Modal>
  )
}
