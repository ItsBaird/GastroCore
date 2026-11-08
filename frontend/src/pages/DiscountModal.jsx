import { LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { applyDiscount } from '../api/orders.js'
import { Field } from '../components/Field.jsx'
import { Modal } from '../components/Modal.jsx'
import { formatCOP } from '../utils/formatCOP.js'

// GC-ORD-0007. Propuesta sin Figma (ningun frame de Cobro dibuja el descuento): Modal y Field del proyecto.
// R4: solo viajan el monto (pesos enteros) y el motivo; el backend valida contra el subtotal y devuelve la
// cuenta recalculada, que es lo que se muestra. Aqui no se calcula ningun total.
const MAX_REASON = 255

const onlyDigits = (value) => value.replace(/\D/g, '').replace(/^0+(?=\d)/, '')

export function DiscountModal({ bill, onApplied, onStale, onClose }) {
  const hasDiscount = bill.discountAmount > 0
  const [amount, setAmount] = useState(hasDiscount ? String(bill.discountAmount) : '')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [general, setGeneral] = useState('')
  const [busy, setBusy] = useState(false)

  const send = async (discountAmount) => {
    setGeneral('')
    setBusy(true)
    try {
      const body = { discountAmount, ...(reason.trim() && { reason: reason.trim() }) }
      onApplied(await applyDiscount(bill.orderId, body), discountAmount)
    } catch (err) {
      setBusy(false)
      if (err?.status === 400) {
        setError(err.message || 'Monto no válido')
      } else if (err?.status === 409 || err?.status === 403 || err?.status === 404) {
        // La mesa ya no esta en cobro, cambio el descuento o no hay permiso: se cierra y se refresca
        onStale(err)
      } else {
        setGeneral(
          err?.status === 0
            ? 'Sin conexión: no se aplicó el descuento. Intenta de nuevo.'
            : err?.message || 'No se pudo aplicar el descuento.',
        )
      }
    }
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    if (!amount) {
      setError('Escribe el monto del descuento')
      return
    }
    const value = Number(amount)
    // Ayuda de UX; la validacion autoritativa es la del backend
    if (value > bill.subtotal) {
      setError(`No puede superar el subtotal (${formatCOP(bill.subtotal)})`)
      return
    }
    send(value)
  }

  const formId = 'discount-form'

  return (
    <Modal
      title={hasDiscount ? 'Cambiar descuento' : 'Aplicar descuento'}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          {hasDiscount && (
            <button
              type="button"
              className="btn btn--ghost bill-discount-remove"
              onClick={() => send(0)}
              disabled={busy}
            >
              Quitar descuento
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" form={formId} className="btn btn--primary" disabled={busy || !amount}>
            {busy && <LoaderCircle className="spin" size={16} />}
            Aplicar
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} noValidate className="bill-discount-form">
        {general && (
          <div className="alert" role="alert">
            {general}
          </div>
        )}

        <p className="bill-discount-context">
          Mesa {bill.tableNumber} · Subtotal {formatCOP(bill.subtotal)}
        </p>

        <Field
          label="Monto del descuento"
          error={error}
          hint={amount ? `Se descontarán ${formatCOP(Number(amount))}` : 'Pesos, sin decimales'}
        >
          {(props) => (
            <input
              {...props}
              className="field__input"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="0"
              value={amount}
              onChange={(event) => {
                setAmount(onlyDigits(event.target.value))
                setError('')
              }}
              disabled={busy}
            />
          )}
        </Field>

        <Field label="Motivo (opcional)" hint="Queda registrado en la auditoría.">
          {(props) => (
            <textarea
              {...props}
              className="field__input bill-discount-reason"
              rows={2}
              maxLength={MAX_REASON}
              placeholder="Cliente frecuente"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={busy}
            />
          )}
        </Field>
      </form>
    </Modal>
  )
}
