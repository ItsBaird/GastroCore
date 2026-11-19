import { LoaderCircle } from 'lucide-react'
import { Modal } from './Modal.jsx'

export function ConfirmDialog({ title, message, confirmLabel, busy, onConfirm, onCancel }) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="btn btn--danger" onClick={onConfirm} disabled={busy}>
            {busy && <LoaderCircle className="spin" size={16} />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ color: 'var(--n-700)', fontSize: 15 }}>{message}</p>
    </Modal>
  )
}
