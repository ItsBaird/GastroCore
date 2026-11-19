import { X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import './Modal.css'

// Dialogo accesible: Escape y clic fuera lo cierran (salvo mientras se guarda),
// el foco entra al primer control y vuelve al elemento que lo abrio.
export function Modal({ title, onClose, busy = false, children, footer }) {
  const titleId = useId()
  const dialogRef = useRef(null)

  useEffect(() => {
    const opener = document.activeElement
    const first = dialogRef.current?.querySelector('input:not([disabled]), select:not([disabled])')
    ;(first ?? dialogRef.current)?.focus()
    return () => opener?.focus?.()
  }, [])

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="modal__header">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="modal__close"
            onClick={onClose}
            disabled={busy}
            aria-label="Cerrar"
          >
            <X size={20} />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__footer">{footer}</footer>}
      </div>
    </div>
  )
}
