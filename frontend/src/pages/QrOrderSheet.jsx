import { CircleCheck, LoaderCircle, Minus, Plus, Send, ShoppingCart, Trash2, X } from 'lucide-react'
import { useId, useState } from 'react'
import { useDialogFocus } from '../hooks/useDialogFocus.js'
import { MAX_NOTE, MAX_QUANTITY } from '../hooks/useOrderCart.js'
import { formatCOP } from '../utils/formatCOP.js'
import './QrSheets.css'

// GC-QR-0003. "Mi Pedido" (propuesta sin Figma: la pestana existe en 69:98 pero no su pantalla). Hoja inferior
// con los mismos tokens que 69:2 y 70:2. Todo texto del cliente se pinta como texto (React escapa).

function CartLine({ line, onQuantity, onNote, onRemove, disabled }) {
  const [editing, setEditing] = useState(false)
  const noteId = useId()
  return (
    <li className={`qr-line${line.problem ? ' qr-line--problem' : ''}`}>
      <div className="qr-line__top">
        <span className="qr-line__name">{line.name}</span>
        <span className="qr-line__price">{formatCOP(line.price * line.quantity)}</span>
      </div>
      {line.note && !editing && <p className="qr-line__note">Nota: {line.note}</p>}
      {editing && (
        <div className="qr-line__note-edit">
          <label className="sr-only" htmlFor={noteId}>
            Nota para {line.name}
          </label>
          <textarea
            id={noteId}
            className="qr-detail__note qr-detail__note--compact"
            maxLength={MAX_NOTE}
            rows={2}
            value={line.note}
            placeholder="Ej: Sin cebolla, extra queso..."
            onChange={(event) => onNote(line.key, event.target.value)}
          />
          <span className="qr-detail__counter">
            {line.note.length}/{MAX_NOTE}
          </span>
        </div>
      )}
      {line.problem && (
        <p className="qr-line__problem" role="alert">
          {line.problem}
        </p>
      )}
      <div className="qr-line__actions">
        <div className="qr-stepper qr-stepper--sm" role="group" aria-label={`Cantidad de ${line.name}`}>
          <button
            type="button"
            className="qr-stepper__minus"
            onClick={() => onQuantity(line.key, line.quantity - 1)}
            disabled={disabled || line.quantity <= 1}
            aria-label={`Quitar uno de ${line.name}`}
          >
            <Minus size={14} aria-hidden="true" />
          </button>
          <span className="qr-stepper__value">{line.quantity}</span>
          <button
            type="button"
            className="qr-stepper__plus"
            onClick={() => onQuantity(line.key, line.quantity + 1)}
            disabled={disabled || line.quantity >= MAX_QUANTITY}
            aria-label={`Agregar uno de ${line.name}`}
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          className="qr-link"
          onClick={() => setEditing((v) => !v)}
          disabled={disabled}
        >
          {editing ? 'Listo' : line.note ? 'Editar nota' : 'Agregar nota'}
        </button>
        <button
          type="button"
          className="qr-icon-btn"
          onClick={() => onRemove(line.key)}
          disabled={disabled}
          aria-label={`Quitar ${line.name} del pedido`}
        >
          <Trash2 size={18} aria-hidden="true" />
        </button>
      </div>
    </li>
  )
}

export function QrOrderSheet({
  cart,
  phase, // editing | sending | sent
  sentLines,
  error,
  blockedReason,
  onSend,
  onClose,
  onContinue,
}) {
  const ref = useDialogFocus(onClose)
  const titleId = useId()
  const sending = phase === 'sending'

  if (phase === 'sent') {
    return (
      <div className="qr-sheet-backdrop">
        <div ref={ref} className="qr-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div className="qr-sheet__done" role="status">
            <CircleCheck size={40} aria-hidden="true" />
            <h2 id={titleId} className="qr-sheet__title">
              ¡Pedido enviado!
            </h2>
            <p className="qr-sheet__text">
              Tu pedido fue enviado a tu mesero; lo revisará en un momento.
            </p>
            <ul className="qr-sent">
              {sentLines.map((l) => (
                <li key={l.key}>
                  <span>{l.name}</span>
                  <span>×{l.quantity}</span>
                </li>
              ))}
            </ul>
            <button type="button" className="qr-detail__add" onClick={onContinue}>
              Seguir viendo el menú
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="qr-sheet-backdrop" onClick={(e) => e.target === e.currentTarget && !sending && onClose()}>
      <div ref={ref} className="qr-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="qr-sheet__head">
          <h2 id={titleId} className="qr-sheet__title">
            Mi Pedido
          </h2>
          <button
            type="button"
            className="qr-icon-btn"
            onClick={onClose}
            disabled={sending}
            aria-label="Cerrar Mi Pedido"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {cart.lines.length === 0 ? (
          <div className="qr-sheet__empty">
            <ShoppingCart size={32} aria-hidden="true" />
            <p>Tu pedido está vacío. Agrega productos desde el menú.</p>
          </div>
        ) : (
          <>
            <ul className="qr-lines">
              {cart.lines.map((line) => (
                <CartLine
                  key={line.key}
                  line={line}
                  disabled={sending}
                  onQuantity={cart.setQuantity}
                  onNote={cart.setNote}
                  onRemove={cart.remove}
                />
              ))}
            </ul>

            <div className="qr-sheet__foot">
              <div className="qr-sheet__total">
                <span>Total referencial</span>
                <strong>{formatCOP(cart.referenceTotal)}</strong>
              </div>
              <p className="qr-sheet__fine">Valor referencial; el mesero confirma tu pedido.</p>

              {error && (
                <p className="qr-sheet__error" role="alert">
                  {error}
                </p>
              )}
              {blockedReason && (
                <p className="qr-sheet__error" role="alert">
                  {blockedReason}
                </p>
              )}

              <button
                type="button"
                className="qr-detail__add"
                onClick={onSend}
                disabled={sending || Boolean(blockedReason) || cart.lines.some((l) => l.problem)}
              >
                {sending ? (
                  <LoaderCircle className="spin" size={18} aria-hidden="true" />
                ) : (
                  <Send size={18} aria-hidden="true" />
                )}
                {sending ? 'Enviando…' : 'Enviar al mesero'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
