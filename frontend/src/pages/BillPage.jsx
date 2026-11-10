import { ArrowLeft, Printer, RefreshCw, Tag, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { cancelBill, getBill } from '../api/orders.js'
import { useAuth } from '../auth/useAuth.js'
import { ConfirmDialog } from '../components/ConfirmDialog.jsx'
import { useToast } from '../components/Toast.jsx'
import { useRealtimeEvent } from '../hooks/useRealtimeEvent.js'
import { WaiterPage } from '../layouts/WaiterLayout.jsx'
import '../styles/waiter.tokens.css'
import { formatCOP } from '../utils/formatCOP.js'
import './billing.tokens.css'
import { BillPayment } from './BillPayment.jsx'
import { DiscountModal } from './DiscountModal.jsx'
import './BillPage.css'

// GC-ORD-0006. Vista de Cobro (Figma 35:2, 39:2, 43:2). Todo monto viene del backend (R4): aqui no se
// suma ni se multiplica nada. GC-ORD-0008: la zona de pago (BillPayment) registra el pago y cierra la orden.

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
  const { user } = useAuth()
  const initialBill = location.state?.bill?.orderId === orderId ? location.state.bill : null

  const [bill, setBill] = useState(initialBill)
  const [loading, setLoading] = useState(!initialBill)
  const [error, setError] = useState(null)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [discounting, setDiscounting] = useState(false)
  // Solo UX: la autoridad es el backend. Mismo criterio que la ruta (ADMIN o discount:apply).
  const canDiscount = user?.role === 'ADMIN' || (user?.permissions ?? []).includes('discount:apply')
  // La cancelacion propia tambien vuelve como table:status_changed: no es "otro dispositivo"
  const cancelledHere = useRef(false)
  // GC-ORD-0008: el pago propio tambien vuelve como table:status_changed (libre) y order:updated (CERRADA)
  const paidHere = useRef(false)
  const lastTotal = useRef(initialBill?.total ?? null)

  const backToDetail = useCallback(
    () => navigate(`/mesero/mesas/${orderId}`, { replace: true }),
    [navigate, orderId],
  )

  // GET /bill es idempotente con la mesa ya en cobro: recargar no genera otra transicion ni otro evento
  const fetchBill = useCallback(
    () =>
      getBill(orderId)
        .then((next) => {
          // Un descuento en vivo cambio el total: se avisa para que el mesero no cobre el viejo
          if (lastTotal.current !== null && next.total !== lastTotal.current) {
            toast.success(`La cuenta cambió: nuevo total ${formatCOP(next.total)}`)
          }
          lastTotal.current = next.total
          setBill(next)
          setError(null)
        })
        .catch((err) => setError(err))
        .finally(() => setLoading(false)),
    [orderId, toast],
  )

  // La cuenta que llega de "Solicitar Cobro" se muestra al instante, pero siempre se refresca con el GET
  // (solo lectura): el estado de la navegacion sobrevive a una recarga y podria estar viejo.
  useEffect(() => {
    fetchBill()
  }, [fetchBill])

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
        if (!bill || cancelledHere.current || paidHere.current) return
        if (status?.tableNumber !== bill.tableNumber) return
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

  // GC-ORD-0007: otra persona (p. ej. el ADMIN) cambio el descuento: se vuelve a pedir la cuenta
  useRealtimeEvent(
    'order:updated',
    useCallback(
      (payload) => {
        if (payload?.orderId !== orderId || paidHere.current) return
        if (payload.status === 'CERRADA') {
          // Otro dispositivo registro el pago
          toast.success('La mesa ya se cerró')
          navigate('/mesero/mesas', { replace: true })
          return
        }
        fetchBill()
      },
      [orderId, fetchBill, toast, navigate],
    ),
    { onReconnect: fetchBill },
  )

  const handleDiscountApplied = (nextBill, amount) => {
    lastTotal.current = nextBill.total
    setBill(nextBill)
    setDiscounting(false)
    toast.success(amount > 0 ? `Descuento de ${formatCOP(amount)} aplicado` : 'Descuento quitado')
  }

  const handleDiscountStale = (err) => {
    setDiscounting(false)
    toast.error(err?.message || 'No se pudo aplicar el descuento')
    fetchBill()
  }

  // El cambio que se muestra es el que calculo el backend (changeGiven), no la estimacion de la pantalla
  const handlePaid = (payment, method) => {
    toast.success(
      payment.changeGiven === null
        ? `Pago registrado · ${formatCOP(payment.total)} con ${method.name}`
        : `Pago registrado · Cambio ${formatCOP(payment.changeGiven)}`,
    )
    navigate('/mesero/mesas', { replace: true })
  }

  const handleAlreadyClosed = () => {
    toast.success('Esta orden ya fue pagada')
    navigate('/mesero/mesas', { replace: true })
  }

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

  // GET /bill ya no pasa la mesa a cobro: si se llega aqui con la orden abierta, no se ofrece cobrar
  if (bill.status !== 'EN_COBRO') {
    return (
      <WaiterPage title={title} showShiftBadge={false}>
        <div className="bill-state" role="alert">
          <TriangleAlert size={28} />
          <p>Esta mesa todavía no está en cobro. Solicita el cobro desde el detalle.</p>
          <button type="button" className="btn btn--ghost" onClick={backToDetail}>
            <ArrowLeft size={16} /> Volver al detalle
          </button>
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
          {canDiscount && (
            <div className="bill-discount-action">
              <button type="button" className="bill-btn-outline" onClick={() => setDiscounting(true)}>
                <Tag size={16} aria-hidden="true" />
                {bill.discountAmount > 0 ? 'Cambiar descuento' : 'Aplicar descuento'}
              </button>
            </div>
          )}
        </section>

        <BillPayment
          bill={bill}
          onPayStart={() => {
            paidHere.current = true
          }}
          onPayFailed={() => {
            paidHere.current = false
          }}
          onPaid={handlePaid}
          onBillStale={fetchBill}
          onAlreadyClosed={handleAlreadyClosed}
        >
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
        </BillPayment>
      </div>

      {discounting && (
        <DiscountModal
          bill={bill}
          onApplied={handleDiscountApplied}
          onStale={handleDiscountStale}
          onClose={() => setDiscounting(false)}
        />
      )}

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
