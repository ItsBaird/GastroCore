import { ClipboardList, LoaderCircle, RefreshCw, X } from 'lucide-react'
import { useId } from 'react'
import { useDialogFocus } from '../hooks/useDialogFocus.js'
import { formatCOP } from '../utils/formatCOP.js'
import './QrSheets.css'

// "Estado" del cliente del QR (Figma 72:2 sin pantalla dibujada: propuesta con los tokens de "Mi Pedido").
// Muestra lo que ya se envio: solicitudes que el mesero aun no confirma (o rechazo) y los productos de la
// mesa con su paso en cocina, mas el total hasta ahora. "Mi Pedido" sigue siendo el carrito por enviar.

const ITEM_STATUS = {
  pendiente: 'Recibido',
  en_preparacion: 'Preparando',
  listo: 'Listo',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
}

const REQUEST_STATUS = {
  pendiente: 'Esperando al mesero',
  rechazada: 'No aceptado por el mesero',
}

function StatusTag({ status, label }) {
  return (
    <span className={`qr-tag qr-tag--${status}`}>
      <span className="qr-tag__dot" aria-hidden="true" />
      {label}
    </span>
  )
}

const timeOf = (iso) =>
  new Date(iso).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' })

export function QrStatusSheet({ status, productNames, onClose }) {
  const ref = useDialogFocus(onClose)
  const titleId = useId()
  const data = status.data
  const requests = data?.requests ?? []
  const items = data?.items ?? []
  const empty = data && requests.length === 0 && items.length === 0

  return (
    <div className="qr-sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="qr-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="qr-sheet__head">
          <h2 id={titleId} className="qr-sheet__title">
            Estado de tu pedido
          </h2>
          <button type="button" className="qr-icon-btn" onClick={onClose} aria-label="Cerrar Estado">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {(status.phase === 'idle' || status.phase === 'loading') && (
          <div className="qr-sheet__empty" role="status">
            <LoaderCircle className="spin" size={32} aria-hidden="true" />
            <p>Cargando tu pedido…</p>
          </div>
        )}

        {status.phase === 'error' && (
          <div className="qr-sheet__empty" role="alert">
            <p>No pudimos cargar el estado de tu pedido.</p>
            <button type="button" className="qr-btn-outline" onClick={status.retry}>
              <RefreshCw size={16} aria-hidden="true" /> Reintentar
            </button>
          </div>
        )}

        {empty && (
          <div className="qr-sheet__empty">
            <ClipboardList size={32} aria-hidden="true" />
            <p>
              {data.status === 'libre'
                ? 'Tu mesa aún no tiene un pedido abierto.'
                : 'Aún no hay productos en tu mesa. Agrega desde el menú y envíalos desde «Mi Pedido».'}
            </p>
          </div>
        )}

        {data && !empty && (
          <>
            <div className="qr-lines" aria-live="polite">
              {requests.length > 0 && (
                <section aria-labelledby={`${titleId}-req`}>
                  <h3 id={`${titleId}-req`} className="qr-status__heading">
                    Enviados al mesero
                  </h3>
                  <ul className="qr-status__list">
                    {requests.map((request, i) => (
                      <li key={`${request.createdAt}-${i}`} className="qr-line">
                        <div className="qr-line__top">
                          <span className="qr-line__name">Pedido de las {timeOf(request.createdAt)}</span>
                          <StatusTag status={`req-${request.status}`} label={REQUEST_STATUS[request.status]} />
                        </div>
                        <ul className="qr-status__products">
                          {request.items.map((item, j) => (
                            <li key={`${item.productId}-${j}`}>
                              {item.quantity} × {productNames.get(item.productId) ?? 'Producto'}
                              {item.note && <span className="qr-line__note"> · {item.note}</span>}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {items.length > 0 && (
                <section aria-labelledby={`${titleId}-items`}>
                  <h3 id={`${titleId}-items`} className="qr-status__heading">
                    En tu mesa
                  </h3>
                  <ul className="qr-status__list">
                    {items.map((item, i) => (
                      <li
                        key={i}
                        className={`qr-line${item.status === 'cancelado' ? ' qr-line--cancelled' : ''}`}
                      >
                        <div className="qr-line__top">
                          <span className="qr-line__name">
                            {item.quantity} × {item.productName}
                          </span>
                          <span className="qr-line__price">{formatCOP(item.lineTotal)}</span>
                        </div>
                        {item.note && <p className="qr-line__note">Nota: {item.note}</p>}
                        <div className="qr-status__tag-row">
                          <StatusTag status={item.status} label={ITEM_STATUS[item.status] ?? item.status} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            <div className="qr-sheet__foot">
              {data.discountAmount > 0 && (
                <div className="qr-sheet__total qr-sheet__total--minor">
                  <span>Descuento</span>
                  <span>−{formatCOP(data.discountAmount)}</span>
                </div>
              )}
              <div className="qr-sheet__total">
                <span>Total hasta ahora</span>
                <strong>{formatCOP(data.total)}</strong>
              </div>
              <p className="qr-sheet__fine">
                {data.status === 'en_cobro'
                  ? 'Tu mesero está preparando tu cuenta.'
                  : 'No incluye lo que aún espera confirmación del mesero. Se actualiza solo.'}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
