import { ArrowLeft, Ban, Clock, Plus, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { cancelItem, deliverItem, getOrderDetail, startBilling } from '../api/orders.js'
import { useAuth } from '../auth/useAuth.js'
import { useToast } from '../components/Toast.jsx'
import { useRealtimeEvent } from '../hooks/useRealtimeEvent.js'
import { WaiterPage } from '../layouts/WaiterLayout.jsx'
import { formatCOP } from '../utils/formatCOP.js'
import '../styles/waiter.tokens.css'
import { CancelItemModal } from './CancelItemModal.jsx'
// --n-600 lo usaban .od-timer y la etiqueta de Subtotal sin estar definido en tokens.css
import './billing.tokens.css'
import './OrderDetailPage.css'

const STATUS_PILL = {
  pendiente: { label: 'Pendiente', className: 'od-pill--pendiente' },
  en_preparacion: { label: 'Preparando', className: 'od-pill--preparando' },
  listo: { label: 'Listo', className: 'od-pill--listo' },
  entregado: { label: 'Entregado', className: 'od-pill--entregado' },
  cancelado: { label: 'Cancelado', className: 'od-pill--cancelado' },
}

// La autoridad es el backend; esto solo evita ofrecer una accion que seria rechazada.
// El mesero que ve el detalle es el asignado: a los demas el backend ya responde 403.
const CANCELLABLE_BY_ROLE = {
  ADMIN: ['pendiente', 'en_preparacion', 'listo'],
  WAITER: ['pendiente'],
}

// Con la orden en cobro el backend rechaza anular (409): no se ofrece.
function canCancel(role, status, orderStatus) {
  return orderStatus === 'ABIERTA' && (CANCELLABLE_BY_ROLE[role] ?? []).includes(status)
}

// GC-ORD-0005: solo los listos se entregan, tambien con la mesa en cobro (decision de la PARADA 0).
function canDeliver(status, orderStatus) {
  return status === 'listo' && orderStatus !== 'CERRADA'
}

const ORDER_BADGE = {
  ABIERTA: { label: 'Ocupada', className: '' },
  EN_COBRO: { label: 'En Cobro', className: 'od-status-badge--en-cobro' },
  CERRADA: { label: 'Cerrada', className: 'od-status-badge--cerrada' },
}

function replaceItem(order, updated) {
  return {
    ...order,
    rounds: order.rounds.map((round) => ({
      ...round,
      items: round.items.map((item) =>
        item.itemId === updated.itemId ? { ...item, ...updated } : item,
      ),
    })),
  }
}

function deliverErrorMessage(err) {
  if (err?.status === 0) return 'Sin conexión: no se entregó el ítem. Intenta de nuevo.'
  if (err?.status === 404) return 'El ítem ya no existe.'
  return err?.message || 'No se pudo entregar el ítem.'
}

function ElapsedTimer({ since }) {
  const [elapsed, setElapsed] = useState('')

  useEffect(() => {
    function update() {
      const diff = Math.floor((Date.now() - new Date(since).getTime()) / 1000)
      const mins = Math.floor(diff / 60)
      const secs = diff % 60
      setElapsed(`${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`)
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [since])

  return (
    <span className="od-timer">
      <Clock size={14} />
      {elapsed}
    </span>
  )
}

export default function OrderDetailPage() {
  const { orderId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [cancelling, setCancelling] = useState(null)
  const [delivering, setDelivering] = useState(() => new Set())

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    getOrderDetail(orderId)
      .then(setOrder)
      .catch((err) => setError(err?.message || 'Error al cargar la orden'))
      .finally(() => setLoading(false))
  }, [orderId])

  // Recarga sin vaciar la pantalla: tras un 409/404 o al reconectar el socket.
  const refresh = useCallback(() => {
    getOrderDetail(orderId)
      .then(setOrder)
      .catch(() => {})
  }, [orderId])

  useEffect(load, [load])

  // Cocina marca listo, otro dispositivo entrega o anula: se refleja sin recargar.
  useRealtimeEvent(
    'item:status_changed',
    useCallback(
      (changed) => {
        if (!changed?.itemId || changed.orderId !== orderId) return
        setOrder((current) => (current ? replaceItem(current, changed) : current))
      },
      [orderId],
    ),
    { onReconnect: refresh },
  )

  const handleCancel = async (reason) => {
    let updated
    try {
      updated = await cancelItem(cancelling.itemId, reason)
    } catch (err) {
      // El estado que veiamos quedo viejo (otro dispositivo o cocina): se recarga detras del modal
      if (err?.status === 409 || err?.status === 404) refresh()
      throw err
    }
    setOrder((current) => replaceItem(current, updated))
    setCancelling(null)
    toast.success(`Se anuló ${updated.productName}`)
  }

  // Sin actualizacion optimista: el item cambia solo con la respuesta del backend.
  const handleDeliver = async (item) => {
    setDelivering((current) => new Set(current).add(item.itemId))
    try {
      const updated = await deliverItem(item.itemId)
      setOrder((current) => replaceItem(current, updated))
      toast.success(`${updated.productName} entregado`)
    } catch (err) {
      toast.error(deliverErrorMessage(err))
      // Otro dispositivo lo entrego, el ADMIN lo anulo o la mesa cambio: se muestra el estado real
      if (err?.status === 409 || err?.status === 404 || err?.status === 403) refresh()
    } finally {
      setDelivering((current) => {
        const next = new Set(current)
        next.delete(item.itemId)
        return next
      })
    }
  }

  // GC-ORD-0006: la cuenta se pide al backend (R4); sus errores (sin entregados, orden cerrada) son la
  // autoridad. Habilitar el boton solo con algo entregado es una ayuda, no la validacion.
  const [requestingBill, setRequestingBill] = useState(false)

  const handleRequestBill = async () => {
    // Ya en cobro: solo se va a la cuenta (la pantalla la lee con GET, sin otra transicion)
    if (order.status === 'EN_COBRO') {
      navigate(`/mesero/mesas/${orderId}/cobro`)
      return
    }
    setRequestingBill(true)
    try {
      const bill = await startBilling(orderId)
      navigate(`/mesero/mesas/${orderId}/cobro`, { state: { bill } })
    } catch (err) {
      toast.error(
        err?.status === 0
          ? 'Sin conexión: no se generó la cuenta. Intenta de nuevo.'
          : err?.message || 'No se pudo generar la cuenta.',
      )
      if (err?.status === 409 || err?.status === 404 || err?.status === 403) refresh()
      setRequestingBill(false)
    }
  }

  const allItems = order?.rounds?.flatMap((r) => r.items) || []
  const activeItems = allItems.filter((i) => i.status !== 'cancelado')

  const statusCounts = activeItems.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + item.quantity
    return acc
  }, {})

  // Los items cancelados no se cobran (R4: los totales que manda el backend son la verdad)
  const subtotal = activeItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0)
  const cancelledCount = allItems.length - activeItems.length
  const billAvailable =
    order?.status === 'EN_COBRO' ||
    (order?.status === 'ABIERTA' && activeItems.some((i) => i.status === 'entregado'))

  return (
    <WaiterPage
      // Los frames de Detalle (32:2, 37:2, 41:2) no muestran la insignia de turno en la barra
      showShiftBadge={false}
      title={
        <span className="od-title-row">
          <button
            type="button"
            className="od-back"
            onClick={() => navigate('/mesero/mesas')}
            aria-label="Volver a mesas"
          >
            <ArrowLeft size={20} />
          </button>
          <span>
            Mesa {order?.tableNumber ?? '—'}
            <span className="od-title-suffix"> — Detalle</span>
          </span>
          {order && (
            <>
              <span
                className={`od-status-badge ${(ORDER_BADGE[order.status] ?? ORDER_BADGE.ABIERTA).className}`}
              >
                {(ORDER_BADGE[order.status] ?? ORDER_BADGE.ABIERTA).label}
              </span>
              <ElapsedTimer since={order.openedAt} />
            </>
          )}
        </span>
      }
    >
      {loading ? (
        <div className="od-loading">Cargando detalle…</div>
      ) : error ? (
        <div className="od-error" role="alert">
          <p>{error}</p>
          <button type="button" className="btn btn--ghost" onClick={load}>
            <RefreshCw size={16} /> Reintentar
          </button>
        </div>
      ) : (
        <div className="od-layout">
          <div className="od-items-section">
            <div className="od-table-header">
              <span className="od-th">Ítem</span>
              <span className="od-th od-th--cant">Cant.</span>
              <span className="od-th od-th--estado">Estado</span>
              <span className="od-th od-th--precio">Precio</span>
              <span className="od-th od-th--acciones">Acciones</span>
            </div>
            {allItems.length === 0 ? (
              <p className="od-empty">No hay ítems en esta orden.</p>
            ) : (
              allItems.map((item) => {
                const cfg = STATUS_PILL[item.status] || STATUS_PILL.pendiente
                const isCancelled = item.status === 'cancelado'
                return (
                  <div
                    key={item.itemId}
                    className={`od-item-row${isCancelled ? ' od-item-row--cancelado' : ''}`}
                  >
                    <span className="od-item-name">
                      <span className="od-item-name__text">{item.productName}</span>
                      {isCancelled && item.cancelledReason && (
                        <span className="od-item-reason">
                          {item.cancelledBy === user?.userId ? 'Anulado por ti' : 'Anulado'} ·{' '}
                          {item.cancelledReason}
                        </span>
                      )}
                    </span>
                    <span className="od-item-qty">{item.quantity}</span>
                    <span className={`od-pill ${cfg.className}`}>{cfg.label}</span>
                    <span className="od-item-price">
                      {formatCOP(item.unitPrice * item.quantity)}
                    </span>
                    <span className="od-item-actions">
                      {canDeliver(item.status, order.status) && (
                        <button
                          type="button"
                          className="od-btn-entregar"
                          disabled={delivering.has(item.itemId)}
                          aria-label={`Entregar ${item.productName}`}
                          onClick={() => handleDeliver(item)}
                        >
                          {delivering.has(item.itemId) ? 'Entregando…' : 'Entregar'}
                        </button>
                      )}
                      {canCancel(user?.role, item.status, order.status) && (
                        <button
                          type="button"
                          className="od-btn-anular"
                          onClick={() => setCancelling(item)}
                        >
                          <Ban size={13} />
                          Anular
                        </button>
                      )}
                    </span>
                  </div>
                )
              })
            )}
          </div>

          {/* Una sola estructura para los tres frames: en escritorio (32:65) el panel lateral completo;
              en tablet (37:51) tarjeta de dos columnas con las filas a la izquierda y los botones a la
              derecha; en movil (41:45) tarjeta compacta y los botones debajo, fuera de ella (41:54). */}
          <aside className="od-summary">
            <div className="od-summary__card">
            <h3 className="od-summary__title">Resumen del Pedido</h3>
            <div className="od-summary__divider" />

            <div className="od-summary__rows">
              <div className="od-summary__row od-summary__row--desktop">
                <span className="od-summary__label">Mesa:</span>
                <span className="od-summary__value">{order.tableNumber}</span>
              </div>
              <div className="od-summary__row">
                <span className="od-summary__label">Ítems totales:</span>
                <span className="od-summary__value">
                  {activeItems.reduce((s, i) => s + i.quantity, 0)}
                </span>
              </div>
              <div className="od-summary__row od-summary__row--no-mobile">
                <span className="od-summary__label">Pendientes:</span>
                <span className="od-summary__value">{statusCounts.pendiente || 0}</span>
              </div>
              <div className="od-summary__row od-summary__row--desktop">
                <span className="od-summary__label">En preparación:</span>
                <span className="od-summary__value">{statusCounts.en_preparacion || 0}</span>
              </div>
              <div className="od-summary__row">
                {/* Figma: "Listos:" en escritorio (32:78) y movil (41:48), "Listos para entregar:" en tablet (37:56) */}
                <span className="od-summary__label">
                  Listos<span className="od-label-tablet"> para entregar</span>:
                </span>
                <span className="od-summary__value">{statusCounts.listo || 0}</span>
              </div>
              <div className="od-summary__row">
                <span className="od-summary__label">Entregados:</span>
                <span className="od-summary__value">{statusCounts.entregado || 0}</span>
              </div>
              {cancelledCount > 0 && (
                <div className="od-summary__row">
                  <span className="od-summary__label">Anulados (no se cobran):</span>
                  <span className="od-summary__value od-summary__value--cancelado">
                    {cancelledCount}
                  </span>
                </div>
              )}
            </div>

            <div className="od-summary__divider od-summary__divider--bottom" />

            <div className="od-summary__row od-summary__row--desktop">
              <span className="od-summary__label-lg">Subtotal:</span>
              <span className="od-summary__value-lg">{formatCOP(subtotal)}</span>
            </div>
            {/* Informativo: la cuenta oficial la calcula GET /bill en el backend (R4) */}
            <div className="od-summary__row od-summary__row--total">
              <span className="od-summary__total-label">Total:</span>
              <span className="od-summary__total-value">{formatCOP(subtotal)}</span>
            </div>
            </div>

            <div className="od-summary__actions">
              <button
                type="button"
                className="od-btn-add"
                disabled={order.status !== 'ABIERTA'}
                title={order.status === 'EN_COBRO' ? 'Cancela el cobro para agregar ítems' : undefined}
                onClick={() =>
                  navigate(`/mesero/mesas/${orderId}/nueva-ronda`, {
                    state: { tableNumber: order.tableNumber },
                  })
                }
              >
                <Plus size={16} />
                Agregar Ítem
              </button>
              <button
                type="button"
                className="od-btn-cobro"
                disabled={!billAvailable || requestingBill}
                title={billAvailable ? undefined : 'Entrega al menos un ítem para pedir la cuenta'}
                onClick={handleRequestBill}
              >
                {requestingBill
                  ? 'Generando cuenta…'
                  : order.status === 'EN_COBRO'
                    ? 'Ver Cobro'
                    : 'Solicitar Cobro'}
              </button>
            </div>
          </aside>
        </div>
      )}

      {cancelling && (
        <CancelItemModal
          item={cancelling}
          onConfirm={handleCancel}
          onClose={() => setCancelling(null)}
        />
      )}
    </WaiterPage>
  )
}
