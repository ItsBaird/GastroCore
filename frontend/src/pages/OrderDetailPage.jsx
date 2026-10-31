import { ArrowLeft, Clock, Plus, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getOrderDetail } from '../api/orders.js'
import { WaiterPage } from '../layouts/WaiterLayout.jsx'
import { formatCOP } from '../utils/formatCOP.js'
import './OrderDetailPage.css'

const STATUS_PILL = {
  pendiente: { label: 'Pendiente', className: 'od-pill--pendiente' },
  en_preparacion: { label: 'Preparando', className: 'od-pill--preparando' },
  listo: { label: 'Listo', className: 'od-pill--listo' },
  entregado: { label: 'Entregado', className: 'od-pill--entregado' },
  cancelado: { label: 'Cancelado', className: 'od-pill--cancelado' },
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
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = () => {
    setLoading(true)
    setError('')
    getOrderDetail(orderId)
      .then(setOrder)
      .catch((err) => setError(err?.message || 'Error al cargar la orden'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [orderId])

  const allItems = order?.rounds?.flatMap((r) => r.items) || []
  const activeItems = allItems.filter((i) => i.status !== 'cancelado')

  const statusCounts = activeItems.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + item.quantity
      return acc
    },
    {},
  )

  const subtotal = activeItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0)

  return (
    <WaiterPage
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
          <span>Mesa {order?.tableNumber ?? '—'} — Detalle</span>
          {order && (
            <>
              <span className="od-status-badge">Ocupada</span>
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
            </div>
            {activeItems.length === 0 ? (
              <p className="od-empty">No hay ítems en esta orden.</p>
            ) : (
              activeItems.map((item) => {
                const cfg = STATUS_PILL[item.status] || STATUS_PILL.pendiente
                return (
                  <div key={item.itemId} className="od-item-row">
                    <span className="od-item-name">{item.productName}</span>
                    <span className="od-item-qty">{item.quantity}</span>
                    <span className={`od-pill ${cfg.className}`}>{cfg.label}</span>
                    <span className="od-item-price">{formatCOP(item.unitPrice * item.quantity)}</span>
                  </div>
                )
              })
            )}
          </div>

          <aside className="od-summary">
            <h3 className="od-summary__title">Resumen del Pedido</h3>
            <div className="od-summary__divider" />

            <div className="od-summary__rows">
              <div className="od-summary__row">
                <span className="od-summary__label">Mesa:</span>
                <span className="od-summary__value">{order.tableNumber}</span>
              </div>
              <div className="od-summary__row">
                <span className="od-summary__label">Ítems totales:</span>
                <span className="od-summary__value">{activeItems.reduce((s, i) => s + i.quantity, 0)}</span>
              </div>
              <div className="od-summary__row">
                <span className="od-summary__label">Pendientes:</span>
                <span className="od-summary__value">{statusCounts.pendiente || 0}</span>
              </div>
              <div className="od-summary__row">
                <span className="od-summary__label">En preparación:</span>
                <span className="od-summary__value">{statusCounts.en_preparacion || 0}</span>
              </div>
              <div className="od-summary__row">
                <span className="od-summary__label">Listos:</span>
                <span className="od-summary__value">{statusCounts.listo || 0}</span>
              </div>
              <div className="od-summary__row">
                <span className="od-summary__label">Entregados:</span>
                <span className="od-summary__value">{statusCounts.entregado || 0}</span>
              </div>
            </div>

            <div className="od-summary__divider" />

            <div className="od-summary__row">
              <span className="od-summary__label-lg">Subtotal:</span>
              <span className="od-summary__value-lg">{formatCOP(subtotal)}</span>
            </div>
            <div className="od-summary__row od-summary__row--total">
              <span className="od-summary__total-label">Total:</span>
              <span className="od-summary__total-value">{formatCOP(subtotal)}</span>
            </div>

            <button
              type="button"
              className="od-btn-add"
              onClick={() => navigate(`/mesero/mesas/${orderId}/nueva-ronda`, { state: { tableNumber: order.tableNumber } })}
            >
              <Plus size={16} />
              Agregar Ítem
            </button>
            <button
              type="button"
              className="od-btn-cobro"
              disabled
            >
              Solicitar Cobro
            </button>
          </aside>
        </div>
      )}
    </WaiterPage>
  )
}
