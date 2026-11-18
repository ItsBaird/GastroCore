import {
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Download,
  LoaderCircle,
  ReceiptText,
  RefreshCw,
  SearchX,
  TriangleAlert,
  Wallet,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { listPaymentMethods } from '../api/paymentMethods.js'
import { listEmployees } from '../api/staff.js'
import { listTables } from '../api/tables.js'
import { useToast } from '../components/Toast.jsx'
import { useSalesHistory } from '../hooks/useSalesHistory.js'
import { AdminPage } from '../layouts/AdminLayout.jsx'
import { todayLocal } from '../utils/cashClose.js'
import { formatCOP } from '../utils/formatCOP.js'
import {
  filterOptions,
  formatClosedAt,
  formatReference,
  HISTORY_PRESETS,
  methodName,
  presetOf,
  rangeLabel,
  tableLabel,
  waiterName,
} from '../utils/salesHistory.js'
import './CatalogPages.css'
import { SaleDetailModal } from './SaleDetailModal.jsx'
import './SalesHistoryPage.css'

// Listas para los filtros y los nombres de la tabla (el historial trae ids de meseros y metodos). Si alguna falla la
// pantalla funciona igual: ese selector queda solo con "Todos" y los nombres salen genericos.
function useLookups() {
  const [lookups, setLookups] = useState({ tables: [], employees: [], methods: [] })
  useEffect(() => {
    let active = true
    Promise.allSettled([listTables(), listEmployees(), listPaymentMethods()]).then(
      ([tables, employees, methods]) => {
        if (!active) return
        const list = (r) => (r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : [])
        setLookups({ tables: list(tables), employees: list(employees), methods: list(methods) })
      },
    )
    return () => {
      active = false
    }
  }, [])
  return lookups
}

function Filters({ filters, setFilters, resetFilters, filterError, options, today }) {
  const active = presetOf(filters, today)
  const dirty = filters.waiterId || filters.tableId || filters.paymentMethodId || active !== 'today'
  const select = (key, label, all, items) => (
    <label className="field sales-filter">
      <span className="field__label">{label}</span>
      <select
        className="field__select"
        value={filters[key]}
        onChange={(e) => setFilters({ [key]: e.target.value })}
      >
        <option value="">{all}</option>
        {items.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <section className="sales-filters" aria-label="Filtros">
      <div className="sales-presets" role="group" aria-label="Periodo">
        {HISTORY_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`btn btn--ghost sales-preset${active === p.id ? ' sales-preset--on' : ''}`}
            aria-pressed={active === p.id}
            onClick={() => setFilters(p.range(today))}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="sales-fields">
        <label className="field sales-filter sales-filter--date">
          <span className="field__label">Desde</span>
          <input
            type="date"
            className="field__input"
            value={filters.from}
            onChange={(e) => setFilters({ from: e.target.value })}
            aria-invalid={Boolean(filterError)}
            aria-describedby={filterError ? 'sales-range-error' : undefined}
          />
        </label>
        <label className="field sales-filter sales-filter--date">
          <span className="field__label">Hasta</span>
          <input
            type="date"
            className="field__input"
            value={filters.to}
            onChange={(e) => setFilters({ to: e.target.value })}
            aria-invalid={Boolean(filterError)}
            aria-describedby={filterError ? 'sales-range-error' : undefined}
          />
        </label>
        {select('waiterId', 'Mesero', 'Todos los meseros', options.waiters)}
        {select('tableId', 'Mesa', 'Todas las mesas', options.tables)}
        {select('paymentMethodId', 'Método de pago', 'Todos los métodos', options.methods)}
        <button type="button" className="btn btn--ghost sales-clear" onClick={resetFilters} disabled={!dirty}>
          <X size={16} aria-hidden="true" /> Limpiar
        </button>
      </div>

      {filterError && (
        <p id="sales-range-error" className="field__error sales-range-error" role="alert">
          {filterError}
        </p>
      )}
    </section>
  )
}

// Resumen del filtro como tipografia (una franja partida por lineas, como el dashboard): no son tarjetas
function Summary({ summary }) {
  const items = [
    { label: 'Total vendido', value: formatCOP(summary.totalSales), icon: DollarSign, lead: true },
    { label: 'Cuentas', value: String(summary.ordersCount), icon: ReceiptText },
    { label: 'Ticket promedio', value: formatCOP(summary.averageTicket), icon: Wallet },
  ]
  return (
    <section className="sales-card sales-summary" aria-label="Resumen del filtro">
      <dl className="sales-kpis">
        {items.map(({ label, value, icon: Icon, lead }) => (
          <div key={label} className={`sales-kpi${lead ? ' sales-kpi--lead' : ''}`}>
            <dt className="sales-kpi__label">
              <Icon size={16} aria-hidden="true" />
              {label}
            </dt>
            <dd className="sales-kpi__value">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function SalesTable({ items, lookups, onSelect }) {
  return (
    <div className="sales-scroll" tabIndex={0} role="region" aria-label="Ventas (desplazable)">
      <table className="sales-table">
        <caption className="sr-only">Ventas cerradas del filtro, la más reciente primero</caption>
        <thead>
          <tr>
            <th scope="col">Referencia</th>
            <th scope="col">Cierre</th>
            <th scope="col">Mesa</th>
            <th scope="col">Mesero</th>
            <th scope="col" className="sales-num">
              Productos
            </th>
            <th scope="col" className="sales-num">
              Total
            </th>
            <th scope="col">Método</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.orderId}>
              <td className="sales-ref">
                {/* La referencia abre el detalle: un boton real (teclado y lector de pantalla), no la fila clicable */}
                <button
                  type="button"
                  className="sales-link"
                  onClick={() => onSelect(row)}
                  aria-label={`Ver detalle de la venta ${formatReference(row.reference, row.orderId)}`}
                >
                  {formatReference(row.reference, row.orderId)}
                </button>
              </td>
              <td className="sales-muted">{formatClosedAt(row.closedAt)}</td>
              <td>{tableLabel(row.tableNumber)}</td>
              <td>{waiterName(lookups.employees, row.waiterId)}</td>
              <td className="sales-num">{row.itemsCount}</td>
              <td className="sales-num sales-strong">{formatCOP(row.total)}</td>
              <td>
                <span className="pill sales-pill">{methodName(lookups.methods, row.paymentMethodId)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Pager({ page, pages, pageSize, total, setPage, busy }) {
  return (
    <nav className="sales-pager" aria-label="Paginación de ventas">
      <span className="sales-pager__info">{rangeLabel(page, pageSize, total)}</span>
      {pages > 1 && (
        <div className="sales-pager__buttons">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setPage(page - 1)}
            disabled={page <= 1 || busy}
          >
            <ChevronLeft size={16} aria-hidden="true" /> Anterior
          </button>
          <span className="sales-pager__page" aria-live="polite">
            Página {page} de {pages}
          </span>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setPage(page + 1)}
            disabled={page >= pages || busy}
          >
            Siguiente <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </nav>
  )
}

function Skeleton() {
  return (
    <div aria-hidden="true">
      <div className="sales-card sales-skeleton sales-skeleton--strip" />
      <div className="sales-card sales-skeleton sales-skeleton--table" />
    </div>
  )
}

export default function SalesHistoryPage() {
  const today = useMemo(() => todayLocal(), [])
  const history = useSalesHistory()
  const lookups = useLookups()
  const options = useMemo(() => filterOptions(lookups), [lookups])
  const { status, data, error, refreshing, isEmpty, page, pages, setPage } = history
  const toast = useToast()
  const [selected, setSelected] = useState(null)
  const [exportError, setExportError] = useState('')

  // El archivo sale con los filtros ACTIVOS. El error (por ejemplo, demasiadas ventas) queda visible hasta el
  // siguiente intento: con un toast se perderia antes de leer como acotar el rango.
  async function onExport() {
    setExportError('')
    const result = await history.exportExcel()
    if (result.ok) toast.success(`Descargado ${result.fileName}`)
    else setExportError(result.message)
  }

  const exportBlocked = status !== 'ready' || isEmpty || Boolean(history.filterError)

  return (
    <AdminPage
      title="Historial de Ventas"
      actions={
        <button
          type="button"
          className="btn btn--primary"
          onClick={onExport}
          disabled={history.exporting || exportBlocked}
          title={isEmpty ? 'No hay ventas para exportar con estos filtros' : undefined}
          aria-label="Exportar a Excel"
        >
          {history.exporting ? (
            <LoaderCircle className="spin" size={18} aria-hidden="true" />
          ) : (
            <Download size={18} aria-hidden="true" />
          )}
          <span className="btn__text">{history.exporting ? 'Generando…' : 'Exportar a Excel'}</span>
        </button>
      }
    >
      <div className="sales" aria-busy={status === 'loading' || refreshing}>
        {exportError && (
          <div className="alert sales-export-error" role="alert">
            <TriangleAlert size={18} aria-hidden="true" />
            <span>{exportError}</span>
            <button
              type="button"
              className="sales-alert-close"
              onClick={() => setExportError('')}
              aria-label="Cerrar aviso"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}

        <Filters
          filters={history.filters}
          setFilters={history.setFilters}
          resetFilters={history.resetFilters}
          filterError={history.filterError}
          options={options}
          today={today}
        />

        {status === 'loading' && <Skeleton />}

        {status === 'error' && (
          <div className="catalog-state catalog-state--card" role="alert">
            <TriangleAlert size={28} aria-hidden="true" />
            <p>{error}</p>
            <button type="button" className="btn btn--ghost" onClick={history.reload}>
              <RefreshCw size={16} aria-hidden="true" /> Reintentar
            </button>
          </div>
        )}

        {status === 'ready' && (
          <>
            <Summary summary={data.summary} />
            <section className="sales-card sales-list" aria-label="Lista de ventas">
              {isEmpty ? (
                <div className="catalog-state" role="status">
                  <SearchX size={28} aria-hidden="true" />
                  <p>No hay ventas cerradas con estos filtros.</p>
                  <p className="sales-muted">Prueba con otro rango de fechas o quita algún filtro.</p>
                </div>
              ) : (
                <>
                  <SalesTable items={data.items} lookups={lookups} onSelect={setSelected} />
                  <Pager
                    page={page}
                    pages={pages}
                    pageSize={data.pageSize}
                    total={data.total}
                    setPage={setPage}
                    busy={refreshing}
                  />
                </>
              )}
            </section>
          </>
        )}

        <p className="sales-foot">Cuentas cerradas por día de negocio, en hora de Colombia (UTC−5).</p>
      </div>

      {selected && <SaleDetailModal row={selected} lookups={lookups} onClose={() => setSelected(null)} />}
    </AdminPage>
  )
}
