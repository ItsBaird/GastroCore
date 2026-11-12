import { ArrowLeft, Minus, Plus, Utensils } from 'lucide-react'
import { useId, useState } from 'react'
import sliceDot from '../assets/qr/slice-dot.svg'
import slice from '../assets/qr/slice.svg'
import { useDialogFocus } from '../hooks/useDialogFocus.js'
import { MAX_LINES, MAX_NOTE, MAX_QUANTITY } from '../hooks/useOrderCart.js'
import { formatCOP } from '../utils/formatCOP.js'
import './QrSheets.css'

// GC-QR-0003. Detalle de producto (Figma 70:2) a pantalla completa. Cambio aprobado en la PARADA 0: el boton
// agrega a "Mi Pedido" en vez de enviar cada producto por separado (el backend admite 3 solicitudes
// pendientes por orden). Sin "Popular" ni "Tiempo aprox." (no estan en el esquema).
export function QrProductSheet({ product, categoryName, cartFull, alreadyInCart, onAdd, onClose }) {
  const ref = useDialogFocus(onClose)
  const titleId = useId()
  const noteId = useId()
  const [quantity, setQuantity] = useState(1)
  const [note, setNote] = useState('')
  const [photoFailed, setPhotoFailed] = useState(false)
  const blocked = cartFull && !alreadyInCart

  return (
    <div ref={ref} className="qr-detail" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      {/* 70:3: zona de 280 sobre #fef2f2 con la foto (o la porcion del Figma) */}
      <div className="qr-detail__hero">
        {product.photoUrl && !photoFailed ? (
          <img
            className="qr-detail__img"
            src={product.photoUrl}
            alt={product.name}
            onError={() => setPhotoFailed(true)}
          />
        ) : (
          <span className="qr-slice qr-slice--lg" aria-hidden="true">
            <img className="qr-slice__body" src={slice} alt="" />
            <img className="qr-slice__dot qr-slice__dot--a" src={sliceDot} alt="" />
            <img className="qr-slice__dot qr-slice__dot--b" src={sliceDot} alt="" />
          </span>
        )}
        {/* 70:7: circulo blanco de 40 en 16/16 */}
        <button type="button" className="qr-detail__back" onClick={onClose} aria-label="Volver al menú">
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
      </div>

      <div className="qr-detail__body">
        <div className="qr-detail__head">
          <h2 id={titleId} className="qr-detail__name">
            {product.name}
          </h2>
          <span className="qr-detail__price">{formatCOP(product.price)}</span>
        </div>
        {product.description && <p className="qr-detail__desc">{product.description}</p>}

        <hr className="qr-detail__rule" />
        {/* 70:20 a 70:26: categoria con su icono de 32 */}
        <div className="qr-detail__meta">
          <span className="qr-detail__meta-icon" aria-hidden="true">
            <Utensils size={16} />
          </span>
          <span>
            <span className="qr-detail__meta-label">Categoría</span>
            <span className="qr-detail__meta-value">{categoryName}</span>
          </span>
        </div>
        <hr className="qr-detail__rule" />

        {/* 70:34 y 70:35: notas para la cocina */}
        <label className="qr-detail__label" htmlFor={noteId}>
          Notas para la cocina (opcional)
        </label>
        <textarea
          id={noteId}
          className="qr-detail__note"
          placeholder="Ej: Sin cebolla, extra queso..."
          maxLength={MAX_NOTE}
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <span className="qr-detail__counter" aria-live="polite">
          {note.length}/{MAX_NOTE}
        </span>
        <hr className="qr-detail__rule" />

        {/* 70:38 a 70:47: cantidad y total */}
        <div className="qr-detail__amount">
          <div>
            <span className="qr-detail__label" id={`${noteId}-qty`}>
              Cantidad
            </span>
            <div className="qr-stepper" role="group" aria-labelledby={`${noteId}-qty`}>
              <button
                type="button"
                className="qr-stepper__minus"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={quantity <= 1}
                aria-label="Quitar uno"
              >
                <Minus size={16} aria-hidden="true" />
              </button>
              <span className="qr-stepper__value" aria-live="polite">
                {quantity}
              </span>
              <button
                type="button"
                className="qr-stepper__plus"
                onClick={() => setQuantity((q) => Math.min(MAX_QUANTITY, q + 1))}
                disabled={quantity >= MAX_QUANTITY}
                aria-label="Agregar uno"
              >
                <Plus size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="qr-detail__total">
            <span className="qr-detail__total-label">Total referencial</span>
            <span className="qr-detail__total-value">{formatCOP(product.price * quantity)}</span>
          </div>
        </div>

        {/* 70:48: boton de 52 */}
        <button
          type="button"
          className="qr-detail__add"
          onClick={() => onAdd(quantity, note)}
          disabled={blocked}
        >
          <Plus size={18} aria-hidden="true" />
          Agregar a mi pedido
        </button>
        <p className="qr-detail__hint">
          {blocked
            ? `Tu pedido ya tiene ${MAX_LINES} productos distintos: envíalo antes de agregar otro.`
            : 'Lo envías desde «Mi Pedido»; el mesero lo confirma.'}
        </p>
      </div>
    </div>
  )
}
