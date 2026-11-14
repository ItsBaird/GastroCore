import { ReceiptText, RefreshCw, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { listPaymentMethods } from '../api/paymentMethods.js'
import { listEmployees } from '../api/staff.js'
import { Field } from '../components/Field.jsx'
import { useCashClosePreview } from '../hooks/useCashClosePreview.js'
import { AdminPage } from '../layouts/AdminLayout.jsx'
import { formatCOP } from '../utils/formatCOP.js'
import { formatLongDate, nameOf } from '../utils/cashClose.js'
import './CashClosePage.css'

const UNKNOWN_METHOD = 'Método sin nombre'
const UNKNOWN_PERSON = 'Sin perfil de empleado'

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
              <td>
                {nameOf(names.methods, 'paymentMethodId', 'name', row.paymentMethodId, UNKNOWN_METHOD)}
              </td>
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

export default function CashClosePage() {
  const { date, setDate, reload, status, data, error } = useCashClosePreview()
  const names = useNames()

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
      </div>

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

      {status === 'ready' && data.tablesServed === 0 && (
        <div className="cc-card cc-empty" role="status">
          <ReceiptText size={32} aria-hidden="true" />
          <h2 className="cc-empty__title">No hay órdenes para cerrar</h2>
          <p>No se cerró ninguna cuenta el {formatLongDate(data.date)}.</p>
        </div>
      )}

      {status === 'ready' && data.tablesServed > 0 && (
        <div className="cc-grid">
          <Summary data={data} names={names} />
          <div className="cc-col">
            <TopProducts products={data.topProducts} />
            <Waiters rows={data.waiterBreakdown} names={names} />
          </div>
        </div>
      )}
    </AdminPage>
  )
}
