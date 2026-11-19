import { RefreshCw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { registerPayment } from '../api/orders.js'
import { listPaymentMethods } from '../api/paymentMethods.js'
import { listPendingQrRequests } from '../api/qrRequests.js'
import { ConfirmDialog } from '../components/ConfirmDialog.jsx'
import { formatCOP } from '../utils/formatCOP.js'

// GC-ORD-0008. Zona de pago de la vista de Cobro (Figma 35:64 a 35:81, 39:38 a 39:55, 43:36 a 43:49).
// R4: solo viajan el metodo y, con efectivo, lo que entrego el cliente. El total es el de la cuenta que devolvio
// el backend; el cambio que se ve mientras se escribe es una estimacion (decision C de la PARADA 0) y el
// definitivo es el changeGiven de la respuesta. El backend vuelve a calcular todo dentro de la transaccion.

// Tope de 9 cifras: cabe en la columna INT de amount_received (2.147.483.647)
const MAX_DIGITS = 9
const onlyDigits = (value) =>
  value
    .replace(/\D/g, '')
    .replace(/^0+(?=\d)/, '')
    .slice(0, MAX_DIGITS)

const formatDigits = (digits) => (digits ? Number(digits).toLocaleString('es-CO') : '')

const plural = (n, one, many) => (n === 1 ? one : many)

export function BillPayment({ bill, onPayStart, onPayFailed, onPaid, onBillStale, onAlreadyClosed, children }) {
  const [methods, setMethods] = useState([])
  const [methodsState, setMethodsState] = useState('loading')
  const [selectedId, setSelectedId] = useState(null)
  const [amount, setAmount] = useState('')
  const [amountError, setAmountError] = useState('')
  const [payError, setPayError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [paying, setPaying] = useState(false)
  const [pendingQr, setPendingQr] = useState(0)

  const loadMethods = useCallback(
    () =>
      listPaymentMethods({ active: true })
      .then((list) => {
        setMethods(list)
        setMethodsState(list.length > 0 ? 'ready' : 'empty')
        // Si el metodo elegido se desactivo mientras tanto, se deselecciona
        setSelectedId((current) => (list.some((m) => m.paymentMethodId === current) ? current : null))
      })
      .catch(() => setMethodsState('error')),
    [],
  )

  const retryMethods = () => {
    setMethodsState('loading')
    loadMethods()
  }

  useEffect(() => {
    loadMethods()
  }, [loadMethods])

  // Aviso de GC-128 (propuesta sin Figma): las solicitudes QR pendientes de esta orden se rechazan al pagar
  useEffect(() => {
    let active = true
    listPendingQrRequests()
      .then((list) => {
        if (active) setPendingQr(list.filter((request) => request.orderId === bill.orderId).length)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [bill.orderId, bill.total])

  const method = methods.find((m) => m.paymentMethodId === selectedId) ?? null
  const isCash = Boolean(method?.isCash)
  const received = amount === '' ? null : Number(amount)
  const short = isCash && received !== null && received < bill.total
  const estimatedChange = isCash && received !== null && !short ? received - bill.total : null

  // Solo UX: el backend vuelve a validar todo
  const canPay =
    Boolean(method) && !paying && (!isCash || (received !== null && received >= bill.total))

  const selectMethod = (id) => {
    setSelectedId(id)
    setPayError('')
    setAmountError('')
  }

  const handleAmount = (event) => {
    setAmount(onlyDigits(event.target.value))
    setAmountError('')
    setPayError('')
  }

  const pay = async () => {
    setPaying(true)
    setPayError('')
    onPayStart()
    try {
      const payment = await registerPayment(bill.orderId, {
        paymentMethodId: method.paymentMethodId,
        ...(isCash && { amountReceived: received }),
      })
      onPaid(payment, method)
    } catch (err) {
      onPayFailed()
      setPaying(false)
      setConfirming(false)
      handlePayError(err)
    }
  }

  const handlePayError = (err) => {
    if (err?.code === 'INSUFFICIENT_AMOUNT') {
      // El total cambio (p. ej. un descuento en vivo): se muestra el vigente del backend
      const total = err.details?.total
      setAmountError(
        total === undefined
          ? 'El monto recibido no alcanza para el total.'
          : `El monto no alcanza: el total vigente es ${formatCOP(total)}.`,
      )
      onBillStale()
      return
    }
    if (err?.code === 'PAYMENT_METHOD_INACTIVE') {
      setPayError('Ese método de pago se desactivó. Elige otro.')
      loadMethods()
      return
    }
    if (err?.status === 409 && err.message === 'La orden ya fue pagada') {
      onAlreadyClosed()
      return
    }
    if (err?.status === 409 && Array.isArray(err.details?.items)) {
      const names = err.details.items.map((item) => item.productName).join(', ')
      setPayError(`Hay ítems sin entregar: ${names}. Entrégalos o anúlalos antes de cobrar.`)
      onBillStale()
      return
    }
    if (err?.status === 0) {
      // Puede que el pago si se haya guardado: al reintentar, el backend responde 409 "ya fue pagada"
      setPayError('Sin conexión: no se confirmó el pago. Intenta de nuevo.')
      return
    }
    if (err?.status === 404 && err.message === 'El método de pago no existe') {
      setPayError('Ese método de pago ya no existe. Elige otro.')
      loadMethods()
      return
    }
    // 403, 404 de la orden, 409 por cobro cancelado o descuento cambiado: se muestra el estado real
    setPayError(err?.message || 'No se pudo registrar el pago.')
    onBillStale()
  }

  const confirmMessage = method
    ? [
        `Mesa ${bill.tableNumber} · ${method.name}`,
        `Total: ${formatCOP(bill.total)}`,
        ...(isCash
          ? [`Recibido: ${formatCOP(received)}`, `Cambio estimado: ${formatCOP(estimatedChange)}`]
          : []),
      ].join(' · ') + '. La orden se cierra y la mesa queda libre.'
    : ''

  return (
    <>
      <section className="bill-card bill-payment" aria-labelledby="bill-payment-title">
        <h2 id="bill-payment-title" className="bill-card__title">
          Método de Pago
        </h2>
        <div className="bill-divider" />

        {pendingQr > 0 && (
          <div className="bill-pay-notice" role="status">
            <TriangleAlert size={16} aria-hidden="true" />
            <span>
              Esta mesa tiene {pendingQr}{' '}
              {plural(pendingQr, 'solicitud QR pendiente', 'solicitudes QR pendientes')}; se{' '}
              {plural(pendingQr, 'rechazará', 'rechazarán')} al pagar.
            </span>
          </div>
        )}

        {methodsState === 'loading' && <p className="bill-pay-state">Cargando métodos de pago…</p>}
        {methodsState === 'error' && (
          <div className="bill-pay-state" role="alert">
            <span>No se pudieron cargar los métodos de pago.</span>
            <button type="button" className="bill-btn-outline" onClick={retryMethods}>
              <RefreshCw size={16} aria-hidden="true" /> Reintentar
            </button>
          </div>
        )}
        {methodsState === 'empty' && (
          <p className="bill-pay-state" role="alert">
            No hay métodos de pago activos. Pide al administrador que active uno.
          </p>
        )}

        {methodsState === 'ready' && (
          <div className="bill-methods" role="radiogroup" aria-label="Método de pago">
            {methods.map((m) => {
              const checked = m.paymentMethodId === selectedId
              return (
                <button
                  key={m.paymentMethodId}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  className={`bill-method${checked ? ' bill-method--selected' : ''}`}
                  onClick={() => selectMethod(m.paymentMethodId)}
                  disabled={paying}
                >
                  <span className="bill-method__radio" aria-hidden="true" />
                  {m.name}
                </button>
              )
            })}
          </div>
        )}

        {isCash && (
          <div className="bill-cash">
            <label className="bill-cash__label" htmlFor="bill-amount">
              Monto recibido<span className="bill-only-desktop">:</span>
            </label>
            <div className={`bill-cash__input${amountError || short ? ' bill-cash__input--error' : ''}`}>
              <span aria-hidden="true">$</span>
              <input
                id="bill-amount"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="0"
                value={formatDigits(amount)}
                onChange={handleAmount}
                disabled={paying}
                aria-invalid={Boolean(amountError || short)}
                aria-describedby={amountError || short ? 'bill-amount-error' : undefined}
              />
            </div>
            <span className="bill-cash__change-label">Cambio:</span>
            <span className="bill-cash__change" aria-live="polite">
              {estimatedChange === null ? '—' : formatCOP(estimatedChange)}
            </span>
            {(amountError || short) && (
              <span id="bill-amount-error" className="bill-cash__error" role="alert">
                {amountError || `Faltan ${formatCOP(bill.total - received)} para el total.`}
              </span>
            )}
          </div>
        )}

        {payError && (
          <div className="alert bill-pay-error" role="alert">
            {payError}
          </div>
        )}
      </section>

      <div className="bill-actions">
        <button
          type="button"
          className="bill-btn-pay"
          disabled={!canPay}
          onClick={() => setConfirming(true)}
        >
          Confirmar Pago — {formatCOP(bill.total)}
        </button>
        {children}
      </div>

      {confirming && method && (
        <ConfirmDialog
          title="Confirmar pago"
          message={confirmMessage}
          confirmLabel="Registrar pago"
          busy={paying}
          onConfirm={pay}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  )
}
