import { ArrowLeft, Printer, RefreshCw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { cancelBill, getBill } from '../api/orders.js'
import { listPaymentMethods } from '../api/paymentMethods.js'
import { ConfirmDialog } from '../components/ConfirmDialog.jsx'
import { useToast } from '../components/Toast.jsx'
import { useRealtimeEvent } from '../hooks/useRealtimeEvent.js'
import { WaiterPage } from '../layouts/WaiterLayout.jsx'
import '../styles/waiter.tokens.css'
import { formatCOP } from '../utils/formatCOP.js'
import './billing.tokens.css'
import './BillPage.css'

// GC-ORD-0006. Vista de Cobro (Figma 35:2, 39:2, 43:2). Todo monto viene del backend (R4): aqui no se
// suma ni se multiplica nada. El pago (metodo, monto recibido, cambio, Confirmar Pago) es de GC-ORD-0008:
// se dibuja como en el Figma pero deshabilitado y rotulado "Proximamente", sin logica falsa.

function loadErrorMessage(err) {
  if (err?.status === 0) return 'Sin conexión con el servidor.'
  if (err?.code === 'NO_DELIVERED_ITEMS') return err.message
  if (err?.status === 403) return 'No tienes asignada esta mesa.'
  if (err?.status === 404) return 'La orden no existe.'
  return err?.message || 'No se pudo cargar la cuenta.'
}

export default function BillPage() {
  const { orderId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToast()
  const initialBill = location.state?.bill?.orderId === orderId ? location.state.bill : null

  const [bill, setBill] = useState(initialBill)
  const [loading, setLoading] = useState(!initialBill)
  const [error, setError] = useState(null)
  const [methods, setMethods] = useState([])
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  // La cancelacion propia tambien vuelve como table:status_changed: no es "otro dispositivo"
  const cancelledHere = useRef(false)

  const backToDetail = useCallback(
    () => navigate(`/mesero/mesas/${orderId}`, { replace: true }),
    [navigate, orderId],
  )

  // GET /bill es idempotente con la mesa ya en cobro: recargar no genera otra transicion ni otro evento
  const fetchBill = useCallback(
    () =>
      getBill(orderId)
        .then((next) => {
          setBill(next)
          setError(null)
        })
        .catch((err) => setError(err))
        .finally(() => setLoading(false)),
    [orderId],
  )

  useEffect(() => {
    if (!initialBill) fetchBill()
  }, [fetchBill, initialBill])

  // Solo para dibujar los metodos reales del restaurante; la seleccion llega con GC-ORD-0008
  useEffect(() => {
    let active = true
    listPaymentMethods({ active: true })
      .then((list) => active && setMethods(list))
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  const retry = () => {
    setLoading(true)
    setError(null)
    fetchBill()
  }

  // Otro dispositivo cancelo el cobro o la mesa se cerro: esta cuenta ya no vale
  useRealtimeEvent(
    'table:status_changed',
    useCallback(
      (status) => {
        if (!bill || cancelledHere.current || status?.tableNumber !== bill.tableNumber) return
        if (status.status === 'ocupada' && status.orderId === orderId) {
          toast.success('Se canceló el cobro de esta mesa desde otro dispositivo')
          backToDetail()
        } else if (status.status === 'libre') {
          toast.success('La mesa ya se cerró')
          navigate('/mesero/mesas', { replace: true })
        }
      },
      [bill, orderId, toast, backToDetail, navigate],
    ),
    { onReconnect: fetchBill },
  )

  const handleCancelBill = async () => {
    setCancelling(true)
    cancelledHere.current = true
    try {
      await cancelBill(orderId)
      toast.success('Cobro cancelado: la mesa vuelve a estar ocupada')
      backToDetail()
    } catch (err) {
      cancelledHere.current = false
      setConfirmingCancel(false)
      setCancelling(false)
      toast.error(
        err?.status === 0
          ? 'Sin conexión: no se canceló el cobro. Intenta de nuevo.'
          : err?.message || 'No se pudo cancelar el cobro.',
      )
      // La mesa ya no esta en cobro (otro dispositivo): el detalle muestra el estado real
      if (err?.status === 409) backToDetail()
    }
  }

  const title = (
    <span className="bill-title-row">
      <button type="button" className="bill-back" onClick={backToDetail} aria-label="Volver al detalle">
        <ArrowLeft size={20} />
      </button>
      <span>Cobro — Mesa {bill?.tableNumber ?? '—'}</span>
      {bill && <span className="bill-badge">En Cobro</span>}
    </span>
  )

  if (loading) {
    return (
      <WaiterPage title={title} showShiftBadge={false}>
        <div className="bill-state">Cargando cuenta…</div>
      </WaiterPage>
    )
  }

  if (error || !bill) {
    const blocking = error?.code === 'NO_DELIVERED_ITEMS' || error?.status === 403 || error?.status === 404
    return (
      <WaiterPage title={title} showShiftBadge={false}>
        <div className="bill-state" role="alert">
          <TriangleAlert size={28} />
          <p>{loadErrorMessage(error)}</p>
          {blocking || error?.status === 409 ? (
            <button type="button" className="btn btn--ghost" onClick={backToDetail}>
              <ArrowLeft size={16} /> Volver al detalle
            </button>
          ) : (
            <button type="button" className="btn btn--ghost" onClick={retry}>
              <RefreshCw size={16} /> Reintentar
            </button>
          )}
        </div>
      </WaiterPage>
    )
  }

  return (
    <WaiterPage title={title} showShiftBadge={false}>
      <div className="bill-layout">
        <section className="bill-card bill-detail" aria-labelledby="bill-detail-title">
          <h2 id="bill-detail-title" className="bill-card__title">
            <span className="bill-only-desktop">Detalle de la Cuenta</span>
            <span className="bill-only-compact">Resumen del Pedido</span>
          </h2>
          <div className="bill-divider" />

          <table className="bill-table">
            <thead>
              <tr>
                <th scope="col">Producto</th>
                <th scope="col" className="bill-num">Cant.</th>
                <th scope="col">P. Unit.</th>
                <th scope="col">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {bill.items.map((item) => (
                <tr key={item.itemId}>
                  <td className="bill-table__name">{item.productName}</td>
                  <td className="bill-table__qty bill-num">
                    <span className="bill-only-compact">×</span>
                    {item.quantity}
                  </td>
                  <td className="bill-table__unit">{formatCOP(item.unitPrice)}</td>
                  <td className="bill-table__line">{formatCOP(item.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {bill.items.length === 0 && <p className="bill-empty">La cuenta no tiene ítems.</p>}

          <div className="bill-divider bill-divider--totals" />
          <dl className="bill-totals">
            <div className="bill-totals__row bill-totals__row--subtotal">
              <dt>
                Subtotal<span className="bill-only-desktop">:</span>
              </dt>
              <dd>{formatCOP(bill.subtotal)}</dd>
            </div>
            {/* Propuesta sin Figma: ningun frame dibuja el descuento; aparece solo si existe (GC-ORD-0007) */}
            {bill.discountAmount > 0 && (
              <div className="bill-totals__row bill-totals__row--discount">
                <dt>Descuento:</dt>
                <dd>−{formatCOP(bill.discountAmount)}</dd>
              </div>
            )}
            <div className="bill-totals__row bill-totals__row--total">
              <dt>
                <span className="bill-only-desktop">Total a Pagar:</span>
                <span className="bill-only-compact">Total</span>
              </dt>
              <dd>{formatCOP(bill.total)}</dd>
            </div>
          </dl>
        </section>

        <section className="bill-card bill-payment" aria-labelledby="bill-payment-title">
          <h2 id="bill-payment-title" className="bill-card__title">
            Método de Pago <span className="bill-soon">Próximamente</span>
          </h2>
          <div className="bill-divider" />

          <div className="bill-methods" role="radiogroup" aria-label="Método de pago" aria-disabled="true">
            {methods.map((method) => (
              <button
                key={method.paymentMethodId}
                type="button"
                role="radio"
                aria-checked="false"
                className="bill-method"
                disabled
              >
                <span className="bill-method__radio" aria-hidden="true" />
                {method.name}
              </button>
            ))}
          </div>

          <div className="bill-cash">
            <label className="bill-cash__label" htmlFor="bill-amount">
              Monto recibido<span className="bill-only-desktop">:</span>
            </label>
            <div className="bill-cash__input">
              <span aria-hidden="true">$</span>
              <input id="bill-amount" type="text" inputMode="numeric" placeholder="—" disabled />
            </div>
            <span className="bill-cash__change-label">Cambio:</span>
            <span className="bill-cash__change">—</span>
          </div>
        </section>

        <div className="bill-actions">
          <button type="button" className="bill-btn-pay" disabled title="Disponible próximamente">
            Confirmar Pago — {formatCOP(bill.total)}
          </button>
          <button type="button" className="bill-btn-outline bill-only-desktop" onClick={() => window.print()}>
            <Printer size={16} aria-hidden="true" /> Imprimir Recibo
          </button>
          <button
            type="button"
            className="bill-btn-outline"
            onClick={() => setConfirmingCancel(true)}
          >
            Cancelar Cobro
          </button>
        </div>
      </div>

      {confirmingCancel && (
        <ConfirmDialog
          title="Cancelar cobro"
          message={`La mesa ${bill.tableNumber} vuelve a estar ocupada y se pueden agregar más ítems. La cuenta se recalcula cuando se vuelva a solicitar.`}
          confirmLabel="Sí, cancelar cobro"
          busy={cancelling}
          onConfirm={handleCancelBill}
          onCancel={() => setConfirmingCancel(false)}
        />
      )}
    </WaiterPage>
  )
}
