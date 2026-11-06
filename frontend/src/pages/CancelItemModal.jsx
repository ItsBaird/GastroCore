import { LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Field } from '../components/Field.jsx'
import { Modal } from '../components/Modal.jsx'
import { formatCOP } from '../utils/formatCOP.js'

const MAX_REASON = 255

// Mismas reglas que el zod del backend, que siempre vuelve a validar
function validate(reason) {
  if (!reason.trim()) return 'El motivo es obligatorio'
  if (reason.trim().length > MAX_REASON) return `Admite hasta ${MAX_REASON} caracteres`
  return ''
}

export function CancelItemModal({ item, onConfirm, onClose }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [general, setGeneral] = useState('')
  const [busy, setBusy] = useState(false)
  const textareaRef = useRef(null)

  // Modal solo enfoca input y select, asi que el textarea se enfoca aqui. Este efecto corre
  // despues del de Modal porque los efectos del hijo van antes que los del padre.
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setGeneral('')

    const found = validate(reason)
    setError(found)
    if (found) return

    setBusy(true)
    try {
      await onConfirm(reason.trim())
    } catch (err) {
      setGeneral(err?.message || 'No se pudo anular el ítem')
      setBusy(false)
    }
  }

  const formId = 'cancel-item-form'

  return (
    <Modal
      title="Anular ítem"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="submit"
            form={formId}
            className="btn btn--danger"
            disabled={busy || !reason.trim()}
          >
            {busy && <LoaderCircle className="spin" size={16} />}
            Anular ítem
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} noValidate className="ci-form">
        {general && (
          <div className="alert" role="alert">
            {general}
          </div>
        )}

        <div className="ci-item">
          <span className="ci-item__name">{item.productName}</span>
          <span className="ci-item__meta">
            ×{item.quantity} · {formatCOP(item.unitPrice * item.quantity)}
          </span>
          {item.note && <span className="ci-item__note">Nota: {item.note}</span>}
        </div>

        <Field
          label="Motivo de la anulación"
          error={error}
          hint="Queda registrado en la auditoría junto con quién anuló el ítem."
        >
          {(props) => (
            <textarea
              {...props}
              ref={textareaRef}
              className="field__input ci-textarea"
              rows={3}
              maxLength={MAX_REASON}
              placeholder="El cliente cambió de opinión"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value)
                setError('')
              }}
              disabled={busy}
            />
          )}
        </Field>

        <p className="ci-counter" aria-live="polite">
          {reason.length}/{MAX_REASON}
        </p>
      </form>
    </Modal>
  )
}
