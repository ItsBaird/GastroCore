import { RefreshCw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { getSalesHistoryOrder } from '../api/history.js'
import { Modal } from '../components/Modal.jsx'
import { formatCOP } from '../utils/formatCOP.js'
import { formatClosedAt, formatReference, methodName, tableLabel, waiterName } from '../utils/salesHistory.js'

function errorMessage(err) {
  if (err?.status === 404) return 'Esta venta ya no está disponible.'
  if (err?.status === 403) return 'No tienes permiso para ver esta venta.'
  if (err?.status === 0) return 'Sin conexión. Revisa la red e intenta de nuevo.'
  return 'No se pudo cargar el detalle de la venta.'
}

// Detalle de una venta (GET /history/{orderId}). Reintentar vuelve a pedirla; si el modal se cierra o cambia de
// venta mientras carga, la respuesta vieja se descarta.
function useSaleDetail(orderId) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ status: 'loading', sale: null, error: '' })

  useEffect(() => {
    let active = true
    getSalesHistoryOrder(orderId)
      .then((sale) => active && setState({ status: 'ready', sale, error: '' }))
      .catch((err) => active && setState({ status: 'error', sale: null, error: errorMessage(err) }))
    return () => {
      active = false
    }
  }, [orderId, attempt])

  const reload = useCallback(() => {
    setState({ status: 'loading', sale: null, error: '' })
    setAttempt((n) => n + 1)
  }, [])

  return { ...state, reload }
}

function Row({ label, children, strong = false, negative = false }) {
  return (
    <div className={`sale-totals__row${strong ? ' sale-totals__row--strong' : ''}`}>
      <dt>{label}</dt>
      <dd className={negative ? 'sale-totals__neg' : undefined}>{children}</dd>
    </div>
  )
}

// GC-RPT-0003 (GC-194). Detalle de la venta elegida en el historial: datos de la cuenta, lineas con el nombre y el
// precio que tenian al pedirse (snapshot R3, sin cancelados), subtotal, descuento, total y, si fue en efectivo, lo
// recibido y el cambio. `row` es la fila del listado: con ella el titulo y los datos de la cuenta se ven al instante.
export function SaleDetailModal({ row, lookups, onClose }) {
  const { status, sale, error, reload } = useSaleDetail(row.orderId)
  const reference = formatReference(row.reference, row.orderId)

  return (
    <Modal title={`Venta ${reference}`} onClose={onClose}>
      <div className="sale-detail">
        <dl className="sale-meta">
          <div>
            <dt>Cierre</dt>
            <dd>{formatClosedAt(row.closedAt)}</dd>
          </div>
          <div>
            <dt>Mesa</dt>
            <dd>{tableLabel(row.tableNumber)}</dd>
          </div>
          <div>
            <dt>Mesero</dt>
            <dd>{waiterName(lookups.employees, row.waiterId)}</dd>
          </div>
          <div>
            <dt>Método de pago</dt>
            <dd>
              <span className="pill sales-pill">{methodName(lookups.methods, row.paymentMethodId)}</span>
            </dd>
          </div>
        </dl>

        {status === 'loading' && (
          <p className="sale-detail__state" role="status">
            Cargando productos…
          </p>
        )}

        {status === 'error' && (
          <div className="sale-detail__state" role="alert">
            <TriangleAlert size={20} aria-hidden="true" />
            <p>{error}</p>
            <button type="button" className="btn btn--ghost" onClick={reload}>
              <RefreshCw size={16} aria-hidden="true" /> Reintentar
            </button>
          </div>
        )}

        {status === 'ready' && (
          <>
            <table className="sale-lines">
              <caption className="sr-only">Productos de la venta</caption>
              <thead>
                <tr>
                  <th scope="col">Producto</th>
                  <th scope="col" className="sales-num">
                    Cant.
                  </th>
                  <th scope="col" className="sales-num">
                    Precio
                  </th>
                  <th scope="col" className="sales-num">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {sale.lines.map((line, index) => (
                  <tr key={`${line.productId}-${index}`}>
                    <td>{line.productName}</td>
                    <td className="sales-num">{line.quantity}</td>
                    <td className="sales-num">{formatCOP(line.unitPrice)}</td>
                    <td className="sales-num sales-strong">{formatCOP(line.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <dl className="sale-totals">
              <Row label="Subtotal">{formatCOP(sale.subtotal)}</Row>
              {sale.discountAmount > 0 && (
                <Row label="Descuento" negative>
                  −{formatCOP(sale.discountAmount)}
                </Row>
              )}
              <Row label="Total" strong>
                {formatCOP(sale.total)}
              </Row>
              {sale.cashReceived !== null && (
                <>
                  <Row label="Efectivo recibido">{formatCOP(sale.cashReceived)}</Row>
                  <Row label="Cambio">{formatCOP(sale.changeGiven)}</Row>
                </>
              )}
            </dl>
          </>
        )}
      </div>
    </Modal>
  )
}
