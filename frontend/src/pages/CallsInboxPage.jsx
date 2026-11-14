import {
  BellRing,
  Check,
  ClipboardList,
  LoaderCircle,
  PencilLine,
  ReceiptText,
  RefreshCw,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { confirmQrRequest, rejectQrRequest } from '../api/qrRequests.js'
import { openTable } from '../api/tablesStatus.js'
import { ConfirmDialog } from '../components/ConfirmDialog.jsx'
import { useToast } from '../components/Toast.jsx'
import { useWaiterInbox } from '../hooks/useWaiterInbox.jsx'
import { WaiterPage } from '../layouts/WaiterLayout.jsx'
import '../styles/waiter.tokens.css'
import './CallsInboxPage.css'

// GC-QR-0002/0003 (propuesta sin Figma: no hay frames de esta bandeja). Seccion "Llamados" del mesero con lo
// que piden los clientes desde el QR. Los textos del cliente (notas) se pintan como texto: React escapa.

function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

function ago(iso, now) {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000))
  if (minutes < 1) return 'ahora'
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `hace ${hours} h`
}

// Errores de confirmar/rechazar: la solicitud ya no esta pendiente o no es de esta mesa -> se recarga
function resolveErrorMessage(err) {
  if (err?.status === 403) return 'Esta mesa ya no está asignada a ti.'
  if (err?.status === 404) return 'La solicitud ya no existe.'
  if (err?.code === 'NO_AVAILABLE_ITEMS') return 'Ninguno de los productos sigue disponible: ajústala o recházala.'
  if (err?.status === 409) return err.message || 'La solicitud ya fue resuelta.'
  if (err?.status === 0) return 'Sin conexión: intenta de nuevo.'
  return err?.message || 'No se pudo completar la acción.'
}

function RequestCard({ request, products, now, onResolved }) {
  const toast = useToast()
  const inbox = useWaiterInbox()
  const [busy, setBusy] = useState(null) // confirm | reject
  const [confirmingReject, setConfirmingReject] = useState(false)

  const handleError = (err) => {
    toast.error(resolveErrorMessage(err))
    if (err?.code !== 'NO_AVAILABLE_ITEMS' && [403, 404, 409].includes(err?.status)) inbox.reload()
  }

  const confirm = async () => {
    setBusy('confirm')
    try {
      const result = await confirmQrRequest(request.qrRequestId)
      const missing = result?.unavailable?.map((u) => u.name).join(', ')
      toast.success(
        missing
          ? `Mesa ${request.tableNumber}: confirmada. No disponibles: ${missing}`
          : `Mesa ${request.tableNumber}: pedido confirmado y enviado a cocina`,
      )
      onResolved(request.qrRequestId)
    } catch (err) {
      handleError(err)
    } finally {
      setBusy(null)
    }
  }

  const reject = async () => {
    setBusy('reject')
    try {
      await rejectQrRequest(request.qrRequestId)
      toast.success(`Mesa ${request.tableNumber}: solicitud rechazada`)
      setConfirmingReject(false)
      onResolved(request.qrRequestId)
    } catch (err) {
      setConfirmingReject(false)
      handleError(err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <li className="inbox-card">
      <div className="inbox-card__head">
        <span className="inbox-card__table">Mesa {request.tableNumber}</span>
        <span className="inbox-card__time">{ago(request.createdAt, now)}</span>
      </div>
      <ul className="inbox-items">
        {request.items.map((item, i) => (
          <li key={`${item.productId}-${i}`} className="inbox-item">
            <span className="inbox-item__qty">×{item.quantity}</span>
            <span className="inbox-item__body">
              <span className="inbox-item__name">
                {products.get(item.productId)?.name ?? 'Producto no disponible'}
              </span>
              {item.note && <span className="inbox-item__note">Nota: {item.note}</span>}
            </span>
          </li>
        ))}
      </ul>
      <div className="inbox-card__actions">
        <button
          type="button"
          className="btn btn--primary inbox-btn"
          onClick={confirm}
          disabled={busy !== null}
        >
          {busy === 'confirm' ? (
            <LoaderCircle className="spin" size={16} aria-hidden="true" />
          ) : (
            <Check size={16} aria-hidden="true" />
          )}
          Confirmar
        </button>
        <Link
          to={`/mesero/solicitudes/${request.qrRequestId}/ajustar`}
          state={{ request }}
          className="btn btn--ghost inbox-btn"
          aria-disabled={busy !== null}
          onClick={(e) => busy !== null && e.preventDefault()}
        >
          <PencilLine size={16} aria-hidden="true" />
          Ajustar
        </Link>
        <button
          type="button"
          className="btn btn--ghost inbox-btn inbox-btn--danger"
          onClick={() => setConfirmingReject(true)}
          disabled={busy !== null}
        >
          <X size={16} aria-hidden="true" />
          Rechazar
        </button>
      </div>

      {confirmingReject && (
        <ConfirmDialog
          title="Rechazar solicitud"
          message={`La solicitud de la mesa ${request.tableNumber} no pasará a cocina. El cliente puede volver a pedir o llamarte.`}
          confirmLabel="Sí, rechazar"
          busy={busy === 'reject'}
          onConfirm={reject}
          onCancel={() => setConfirmingReject(false)}
        />
      )}
    </li>
  )
}

function CallRow({ call, now }) {
  const toast = useToast()
  const navigate = useNavigate()
  const [opening, setOpening] = useState(false)
  const isBill = call.type === 'request_bill'

  const open = async () => {
    setOpening(true)
    try {
      const order = await openTable(call.tableId)
      toast.success(`Mesa ${call.tableNumber} abierta: el llamado queda atendido`)
      navigate(`/mesero/mesas/${order.orderId}`)
    } catch (err) {
      toast.error(
        err?.code === 'NO_ACTIVE_SHIFT'
          ? 'Debes iniciar tu turno para abrir la mesa.'
          : err?.message || 'No se pudo abrir la mesa.',
      )
      setOpening(false)
    }
  }

  return (
    <li className={`inbox-call${isBill ? ' inbox-call--bill' : ''}`}>
      <span className="inbox-call__icon" aria-hidden="true">
        {isBill ? <ReceiptText size={18} /> : <BellRing size={18} />}
      </span>
      <span className="inbox-call__body">
        <span className="inbox-call__title">
          Mesa {call.tableNumber} · {isBill ? 'Pide la cuenta' : 'Llama al mesero'}
        </span>
        <span className="inbox-call__time">{ago(call.createdAt, now)}</span>
      </span>
      {call.tableStatus === 'libre' ? (
        <button type="button" className="btn btn--ghost inbox-btn" onClick={open} disabled={opening}>
          {opening && <LoaderCircle className="spin" size={16} aria-hidden="true" />}
          Abrir mesa
        </button>
      ) : (
        call.orderId && (
          <Link className="btn btn--ghost inbox-btn" to={`/mesero/mesas/${call.orderId}`}>
            Ir a la mesa
          </Link>
        )
      )}
    </li>
  )
}

export default function CallsInboxPage() {
  const inbox = useWaiterInbox()
  const now = useNow()

  return (
    <WaiterPage title="Llamados">
      {inbox.phase === 'error' && (
        <div className="inbox-state" role="alert">
          <p>No se pudieron cargar los llamados.</p>
          <button type="button" className="btn btn--ghost" onClick={inbox.reload}>
            <RefreshCw size={16} aria-hidden="true" /> Reintentar
          </button>
        </div>
      )}

      <section className="inbox-section" aria-labelledby="inbox-requests">
        <h2 id="inbox-requests" className="inbox-section__title">
          <ClipboardList size={18} aria-hidden="true" />
          Solicitudes de pedido
          <span className="inbox-count">{inbox.requests.length}</span>
        </h2>
        {inbox.phase === 'loading' ? (
          <p className="inbox-empty">Cargando…</p>
        ) : inbox.requests.length === 0 ? (
          <p className="inbox-empty">No hay solicitudes de pedido pendientes.</p>
        ) : (
          <ul className="inbox-list" aria-live="polite">
            {inbox.requests.map((r) => (
              <RequestCard
                key={r.qrRequestId}
                request={r}
                products={inbox.products}
                now={now}
                onResolved={inbox.removeRequest}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="inbox-section" aria-labelledby="inbox-calls">
        <h2 id="inbox-calls" className="inbox-section__title">
          <BellRing size={18} aria-hidden="true" />
          Llamados
          <span className="inbox-count">{inbox.calls.length}</span>
        </h2>
        {inbox.phase === 'loading' ? (
          <p className="inbox-empty">Cargando…</p>
        ) : inbox.calls.length === 0 ? (
          <p className="inbox-empty">No hay llamados pendientes.</p>
        ) : (
          <>
            <ul className="inbox-list" aria-live="polite">
              {inbox.calls.map((c) => (
                <CallRow key={c.serviceCallId} call={c} now={now} />
              ))}
            </ul>
            <p className="inbox-hint">
              El llamado se marca como atendido al abrir la mesa o al cobrarla.
            </p>
          </>
        )}
      </section>
    </WaiterPage>
  )
}
