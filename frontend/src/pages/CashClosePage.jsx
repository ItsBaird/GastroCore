import { ChevronLeft, ChevronRight, LoaderCircle, ReceiptText, RefreshCw, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { listPaymentMethods } from '../api/paymentMethods.js'
import { listEmployees } from '../api/staff.js'
import { Field } from '../components/Field.jsx'
import { Modal } from '../components/Modal.jsx'
import { useToast } from '../components/Toast.jsx'
import { useCashClose } from '../hooks/useCashClose.js'
import { useCashClosures } from '../hooks/useCashClosures.js'
import { AdminPage } from '../layouts/AdminLayout.jsx'
import { formatCOP } from '../utils/formatCOP.js'
import { formatDateTime, formatLongDate, formatShortDate, isFutureDay, nameOf } from '../utils/cashClose.js'
import './CashClosePage.css'

const UNKNOWN_METHOD = 'Método sin nombre'
const UNKNOWN_PERSON = 'Sin perfil de empleado'
const UNKNOWN_ADMIN = 'Administrador'

// La vista previa trae ids; los nombres vienen de otros servicios. Si alguno falla la pantalla se muestra igual con
// un nombre generico: los montos son lo importante y no dependen de eso.
function useNames() {
  const [names, setNames] = useState({ methods: [], people: [] })

  useEffect(() => {
    let active = true
    Promise.allSettled([listPaymentMethods(), listEmployees()]).then(([methods, people]) => {
      if (!active) return
      setNames({
        methods: methods.status === 'fulfilled' ? methods.value : [],
        people: people.status === 'fulfilled' ? people.value : [],
      })
    })
    return () => {
      active = false
    }
  }, [])

  return names
}

function Skeleton() {
  return (
    <div className="cc-grid" aria-hidden="true">
      <div className="cc-card cc-card--skeleton cc-card--tall" />
      <div className="cc-col">
        <div className="cc-card cc-card--skeleton" />
        <div className="cc-card cc-card--skeleton" />
      </div>
    </div>
  )
}

function Summary({ data, names }) {
  return (
    <section className="cc-card" aria-labelledby="cc-summary-title">
      <h2 className="cc-card__title" id="cc-summary-title">
        Resumen del Día
      </h2>
      <p className="cc-card__sub">{formatLongDate(data.date)}</p>

      <div className="cc-total">
        <span className="cc-total__label">Total de ventas</span>
        <span className="cc-total__value">{formatCOP(data.totalSales)}</span>
      </div>

      <h3 className="cc-section">Desglose por método de pago</h3>
      <table className="cc-table">
        <thead>
          <tr>
            <th scope="col">Método</th>
            <th scope="col" className="cc-num">
              Pagos
            </th>
            <th scope="col" className="cc-num">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {data.paymentBreakdown.map((row) => (
            <tr key={row.paymentMethodId}>
              <td>{nameOf(names.methods, 'paymentMethodId', 'name', row.paymentMethodId, UNKNOWN_METHOD)}</td>
              <td className="cc-num">{row.paymentCount}</td>
              <td className="cc-num cc-strong">{formatCOP(row.totalAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="cc-section">Estadísticas</h3>
      <dl className="cc-stats">
        <div className="cc-stats__row">
          <dt>Mesas atendidas</dt>
          <dd>{data.tablesServed}</dd>
        </div>
        <div className="cc-stats__row">
          <dt>Ticket promedio</dt>
          <dd>{formatCOP(data.averageTicket)}</dd>
        </div>
      </dl>
    </section>
  )
}

function TopProducts({ products }) {
  return (
    <section className="cc-card" aria-labelledby="cc-top-title">
      <h2 className="cc-card__title" id="cc-top-title">
        Platos más vendidos
      </h2>
      {products.length === 0 ? (
        <p className="cc-card__empty">Ningún plato vendido en esta fecha.</p>
      ) : (
        <table className="cc-table">
          <thead>
            <tr>
              <th scope="col" className="cc-rank-col">
                #
              </th>
              <th scope="col">Plato</th>
              <th scope="col" className="cc-num">
                Unidades
              </th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.productId}>
                <td className="cc-rank-col">
                  <span className="cc-rank">{p.rank}</span>
                </td>
                <td>{p.productName}</td>
                <td className="cc-num cc-strong">{p.quantitySold}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function Waiters({ rows, names }) {
  return (
    <section className="cc-card" aria-labelledby="cc-waiters-title">
      <h2 className="cc-card__title" id="cc-waiters-title">
        Ingresos por mesero
      </h2>
      <p className="cc-card__sub">Atribuidos al mesero que abrió la mesa</p>
      <table className="cc-table">
        <thead>
          <tr>
            <th scope="col">Mesero</th>
            <th scope="col" className="cc-num">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.waiterId}>
              <td>{nameOf(names.people, 'userId', 'fullName', row.waiterId, UNKNOWN_PERSON)}</td>
              <td className="cc-num cc-strong">{formatCOP(row.totalAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

// Estado de la caja ese dia (el dato de contexto de la pantalla): abierta, o cerrada y por quien.
function Banner({ date, closure, names }) {
  if (!closure) {
    return (
      <div className="cc-banner cc-banner--open" role="status">
        <span className="cc-dot" aria-hidden="true" />
        <p>
          <strong>Caja abierta</strong> · {formatLongDate(date)}
        </p>
      </div>
    )
  }
  const who = nameOf(names.people, 'userId', 'fullName', closure.confirmedBy, UNKNOWN_ADMIN)
  return (
    <div className="cc-banner cc-banner--closed" role="status">
      <span className="cc-dot" aria-hidden="true" />
      <p>
        <strong>Caja cerrada</strong> · confirmada por {who} el {formatDateTime(closure.confirmedAt)}
      </p>
    </div>
  )
}

function ConfirmCloseModal({ data, busy, error, onConfirm, onCancel }) {
  return (
    <Modal
      title="Confirmar cierre de caja"
      onClose={onCancel}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="btn btn--primary" onClick={onConfirm} disabled={busy}>
            {busy && <LoaderCircle className="spin" size={16} aria-hidden="true" />}
            Confirmar cierre
          </button>
        </>
      }
    >
      <p className="cc-modal__lead">Vas a cerrar la caja del {formatLongDate(data.date)}.</p>
      <dl className="cc-stats">
        <div className="cc-stats__row">
          <dt>Total de ventas</dt>
          <dd>{formatCOP(data.totalSales)}</dd>
        </div>
        <div className="cc-stats__row">
          <dt>Mesas atendidas</dt>
          <dd>{data.tablesServed}</dd>
        </div>
      </dl>
      <p className="cc-modal__note">
        Se guarda el consolidado y ya no se podrán registrar cobros de ese día. Solo un administrador puede
        corregirlo después, y queda en la auditoría.
      </p>
      {error && (
        <p className="cc-modal__error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}

function History({ history, names, selected, onSelect }) {
  const { status, items, error, page, pages, setPage, reload } = history
  return (
    <section className="cc-card" aria-labelledby="cc-history-title">
      <h2 className="cc-card__title" id="cc-history-title">
        Historial de Cierres
      </h2>

      {status === 'error' && (
        <div className="cc-history__state" role="alert">
          <p>{error}</p>
          <button type="button" className="btn btn--ghost" onClick={reload}>
            <RefreshCw size={16} aria-hidden="true" /> Reintentar
          </button>
        </div>
      )}

      {status === 'loading' && items.length === 0 && (
        <p className="cc-card__empty" role="status">
          Cargando historial…
        </p>
      )}

      {status === 'ready' && items.length === 0 && (
        <p className="cc-card__empty">Todavía no hay cierres confirmados.</p>
      )}

      {items.length > 0 && (
        <>
          <table className="cc-table cc-history" aria-busy={status === 'loading'}>
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Responsable</th>
                <th scope="col" className="cc-num">
                  Total
                </th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.closureId} className={row.date === selected ? 'cc-history__row--on' : undefined}>
                  <td>
                    <button
                      type="button"
                      className="cc-link"
                      onClick={() => onSelect(row.date)}
                      aria-label={`Ver el cierre del ${formatLongDate(row.date)}`}
                      aria-current={row.date === selected ? 'date' : undefined}
                    >
                      {formatShortDate(row.date)}
                    </button>
                  </td>
                  <td>{nameOf(names.people, 'userId', 'fullName', row.confirmedBy, UNKNOWN_ADMIN)}</td>
                  <td className="cc-num cc-strong">{formatCOP(row.totalSales)}</td>
                  <td>
                    <span className="pill cc-pill--closed">Cerrado</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {pages > 1 && (
            <nav className="cc-pager" aria-label="Paginación del historial">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setPage(page - 1)}
                disabled={page <= 1 || status === 'loading'}
              >
                <ChevronLeft size={16} aria-hidden="true" /> Anterior
              </button>
              <span className="cc-pager__info">
                Página {page} de {pages}
              </span>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setPage(page + 1)}
                disabled={page >= pages || status === 'loading'}
              >
                Siguiente <ChevronRight size={16} aria-hidden="true" />
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  )
}

// Por que el boton "Cerrar Caja" no se puede usar (null = se puede). Se muestra como texto, no solo como tooltip.
function closeBlocker({ status, closed, date, data }) {
  if (status !== 'ready') return null
  if (closed) return 'Este día ya está cerrado.'
  if (isFutureDay(date)) return 'Ese día todavía no empieza: no se puede cerrar.'
  if (data.tablesServed === 0) return 'No hay órdenes para cerrar ese día.'
  return null
}

export default function CashClosePage() {
  const toast = useToast()
  const history = useCashClosures()
  const { reload: reloadHistory } = history
  const { date, setDate, reload, status, data, error, closure, closed, confirm, confirming } = useCashClose({
    onClosed: reloadHistory,
  })
  const names = useNames()
  const [dialog, setDialog] = useState({ open: false, error: '' })

  const blocker = closeBlocker({ status, closed, date, data })
  const canClose = status === 'ready' && blocker === null

  async function onConfirm() {
    const result = await confirm()
    if (result.ok) {
      setDialog({ open: false, error: '' })
      toast.success('Cierre de caja confirmado')
    } else if (result.dayClosed) {
      setDialog({ open: false, error: '' })
      toast.error(result.message)
    } else {
      setDialog({ open: true, error: result.message })
    }
  }

  return (
    <AdminPage title="Cierre de Caja">
      <div className="cc-toolbar">
        <Field label="Fecha">
          {(fieldProps) => (
            <input
              {...fieldProps}
              type="date"
              className="field__input cc-date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          )}
        </Field>
        <button type="button" className="btn btn--ghost" onClick={reload}>
          <RefreshCw size={16} aria-hidden="true" /> Actualizar
        </button>
        <div className="cc-toolbar__close">
          <button
            type="button"
            className="btn btn--primary"
            disabled={!canClose}
            aria-describedby={blocker ? 'cc-close-hint' : undefined}
            onClick={() => setDialog({ open: true, error: '' })}
          >
            Cerrar Caja
          </button>
          {blocker && (
            <p className="cc-hint" id="cc-close-hint">
              {blocker}
            </p>
          )}
        </div>
      </div>

      {status === 'ready' && <Banner date={date} closure={closure} names={names} />}

      {status === 'loading' && <Skeleton />}

      {status === 'error' && (
        <div className="catalog-state catalog-state--card" role="alert">
          <TriangleAlert size={28} aria-hidden="true" />
          <p>{error}</p>
          <button type="button" className="btn btn--ghost" onClick={reload}>
            <RefreshCw size={16} aria-hidden="true" /> Reintentar
          </button>
        </div>
      )}

      {status === 'ready' && data.tablesServed === 0 && !closed && (
        <div className="cc-grid">
          <div className="cc-card cc-empty" role="status">
            <ReceiptText size={32} aria-hidden="true" />
            <h2 className="cc-empty__title">No hay órdenes para cerrar</h2>
            <p>No se cerró ninguna cuenta el {formatLongDate(data.date)}.</p>
          </div>
          <History history={history} names={names} selected={date} onSelect={setDate} />
        </div>
      )}

      {status === 'ready' && (data.tablesServed > 0 || closed) && (
        <div className="cc-grid">
          <div className="cc-col">
            <Summary data={data} names={names} />
            <Waiters rows={data.waiterBreakdown} names={names} />
          </div>
          <div className="cc-col">
            <History history={history} names={names} selected={date} onSelect={setDate} />
            <TopProducts products={data.topProducts} />
          </div>
        </div>
      )}

      {dialog.open && canClose && (
        <ConfirmCloseModal
          data={data}
          busy={confirming}
          error={dialog.error}
          onConfirm={onConfirm}
          onCancel={() => setDialog({ open: false, error: '' })}
        />
      )}
    </AdminPage>
  )
}
