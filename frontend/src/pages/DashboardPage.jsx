import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Clock,
  CreditCard,
  DollarSign,
  Minus,
  ReceiptText,
  RefreshCw,
  Timer,
  TriangleAlert,
  Trophy,
  Users,
  Wallet,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { listPaymentMethods } from '../api/paymentMethods.js'
import { listEmployees } from '../api/staff.js'
import { useDashboard } from '../hooks/useDashboard.js'
import { AdminPage } from '../layouts/AdminLayout.jsx'
import {
  businessToday,
  deltaTone,
  formatCompactCOP,
  formatCount,
  formatHourSlot,
  formatMinutes,
  formatPercent,
  formatRange,
  formatShare,
  formatShortDate,
  formatWeekday,
  labelStep,
  PRESETS,
  remainingDays,
  validateRange,
} from '../utils/dashboard.js'
import { formatCOP } from '../utils/formatCOP.js'
import './CatalogPages.css'
import { ChartCard, ColumnChart, RankList } from './DashboardCharts.jsx'
import './DashboardPage.css'

const UNKNOWN_WAITER = 'Mesero no disponible'
const UNKNOWN_METHOD = 'Método no disponible'

// Nombres de meseros y metodos (el dashboard trae ids, como el cierre de caja). Si alguno falla, nombre generico:
// los montos no dependen de eso y nunca se omiten (la suma por mesero sigue dando las ventas).
function useNames() {
  const [names, setNames] = useState({ people: new Map(), methods: new Map() })
  useEffect(() => {
    let active = true
    Promise.allSettled([listEmployees(), listPaymentMethods()]).then(([people, methods]) => {
      if (!active) return
      const list = (result) => (result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : [])
      setNames({
        people: new Map(list(people).map((p) => [p.userId, p.fullName])),
        methods: new Map(list(methods).map((m) => [m.paymentMethodId, m.name])),
      })
    })
    return () => {
      active = false
    }
  }, [])
  return names
}

// La mayor de una serie, solo para marcarla (la serie la calcula el backend). null si todo es cero.
function peakOf(rows) {
  return rows.reduce((best, r) => (r.totalSales > (best?.totalSales ?? 0) ? r : best), null)
}

const money = (value) => formatCOP(value)

// "1 cuenta", "2 cuentas", "1 ítem". El singular se pasa cuando no basta con quitar la "s" (unidades -> unidad)
const plural = (count, many, one = many.replace(/s$/, '')) => `${formatCount(count)} ${count === 1 ? one : many}`

function SalesByDay({ rows }) {
  const peak = peakOf(rows)
  const short = rows.length <= 7
  const dayLabel = (date) => `${formatWeekday(date)} ${formatShortDate(date)}`
  const total = rows.reduce((s, r) => s + r.totalSales, 0)
  return (
    <ChartCard
      title="Ventas por día"
      icon={CalendarDays}
      tone="red"
      subtitle={
        peak ? (
          <span className="dash-peak">
            Día más alto: <strong>{dayLabel(peak.date)}</strong> · <strong>{money(peak.totalSales)}</strong>
          </span>
        ) : (
          'Total cobrado cada día'
        )
      }
      table={{
        columns: [
          { key: 'day', label: 'Día' },
          { key: 'sales', label: 'Ventas', numeric: true },
          { key: 'orders', label: 'Cuentas', numeric: true },
        ],
        rows: rows.map((r) => ({
          key: r.date,
          cells: { day: dayLabel(r.date), sales: money(r.totalSales), orders: formatCount(r.orders) },
        })),
      }}
    >
      <ColumnChart
        items={rows.map((r) => ({
          key: r.date,
          label: dayLabel(r.date),
          // Eje corto ("lun 9"): el dia completo ("lun 9 nov") va en el tooltip y en la tabla
          axisLabel: short ? `${formatWeekday(r.date)} ${Number(r.date.slice(8))}` : formatShortDate(r.date),
          value: r.totalSales,
          display: `${money(r.totalSales)} · ${formatCount(r.orders)} cuentas`,
        }))}
        highlightKey={peak?.date}
        labelEvery={labelStep(rows.length, short ? 7 : 6)}
        formatTick={formatCompactCOP}
        summary={`Ventas por día, ${rows.length} días, total ${money(total)}.${peak ? ` Día más alto: ${dayLabel(peak.date)} con ${money(peak.totalSales)}.` : ' Sin ventas.'}`}
      />
    </ChartCard>
  )
}

function SalesByHour({ rows }) {
  const peak = peakOf(rows)
  return (
    <ChartCard
      title="Ventas por hora de cobro"
      icon={Clock}
      tone="red"
      subtitle={
        peak ? (
          <span className="dash-peak">
            Hora pico: <strong>{formatHourSlot(peak.hour)}</strong> · <strong>{money(peak.totalSales)}</strong>
          </span>
        ) : (
          'Suma del periodo en cada hora'
        )
      }
      table={{
        columns: [
          { key: 'hour', label: 'Hora' },
          { key: 'sales', label: 'Ventas', numeric: true },
          { key: 'orders', label: 'Cuentas', numeric: true },
        ],
        rows: rows.map((r) => ({
          key: r.hour,
          cells: { hour: formatHourSlot(r.hour), sales: money(r.totalSales), orders: formatCount(r.orders) },
        })),
      }}
    >
      <ColumnChart
        items={rows.map((r) => ({
          key: r.hour,
          label: formatHourSlot(r.hour),
          axisLabel: `${r.hour} h`,
          value: r.totalSales,
          display: `${money(r.totalSales)} · ${formatCount(r.orders)} cuentas`,
        }))}
        highlightKey={peak?.hour}
        labelEvery={3}
        formatTick={formatCompactCOP}
        summary={`Ventas por hora del día, sumadas sobre el periodo.${peak ? ` Hora pico: ${formatHourSlot(peak.hour)} con ${money(peak.totalSales)}.` : ' Sin ventas.'}`}
      />
      <p className="dash-note">Hora en que se cobró la cuenta, en hora de Colombia.</p>
    </ChartCard>
  )
}

function TopProducts({ rows }) {
  return (
    <ChartCard
      title="Top 5 productos"
      icon={Trophy}
      tone="orange"
      subtitle="Por unidades vendidas; ingreso bruto antes de descuentos"
      table={
        rows.length > 0 && {
          columns: [
            { key: 'name', label: 'Producto' },
            { key: 'qty', label: 'Unidades', numeric: true },
            { key: 'revenue', label: 'Ingreso bruto', numeric: true },
          ],
          rows: rows.map((p) => ({
            key: p.productId,
            cells: { name: `${p.rank}. ${p.productName}`, qty: formatCount(p.quantitySold), revenue: money(p.revenue) },
          })),
        }
      }
    >
      <RankList
        summary="Top 5 productos por unidades vendidas"
        empty="Ningún producto vendido en este periodo."
        numbered
        rows={rows.map((p) => ({
          key: p.productId,
          name: p.productName,
          value: p.quantitySold,
          primary: `${formatCount(p.quantitySold)} u.`,
          secondary: `${money(p.revenue)} ingreso bruto`,
        }))}
      />
    </ChartCard>
  )
}

function Preparation({ preparation }) {
  const { averageMinutes, itemsMeasured, byCategory } = preparation
  let empty = 'Sin ítems preparados en este periodo.'
  if (itemsMeasured > 0 && byCategory === null) {
    // Catalog no respondio o aun no entrega la categoria: el promedio general sigue siendo valido
    empty = 'El desglose por categoría no está disponible por ahora; el promedio general sí.'
  } else if (itemsMeasured > 0) {
    empty = 'Sin categorías para mostrar.'
  }
  const rows = byCategory ?? []
  return (
    <ChartCard
      title="Tiempo de preparación"
      icon={Timer}
      tone="mustard"
      subtitle={
        averageMinutes === null ? (
          'Desde que el pedido llega a cocina hasta que está listo'
        ) : (
          <>
            Promedio <strong>{formatMinutes(averageMinutes)}</strong> · {plural(itemsMeasured, 'ítems')} medidos ·
            menos es mejor
          </>
        )
      }
      table={
        rows.length > 0 && {
          columns: [
            { key: 'name', label: 'Categoría' },
            { key: 'minutes', label: 'Promedio', numeric: true },
            { key: 'items', label: 'Ítems', numeric: true },
          ],
          rows: rows.map((c) => ({
            key: c.categoryId,
            cells: { name: c.categoryName, minutes: formatMinutes(c.averageMinutes), items: formatCount(c.itemsMeasured) },
          })),
        }
      }
    >
      <RankList
        summary="Tiempo promedio de preparación por categoría"
        empty={empty}
        rows={rows.map((c) => ({
          key: c.categoryId,
          name: c.categoryName,
          value: c.averageMinutes,
          primary: formatMinutes(c.averageMinutes),
          secondary: plural(c.itemsMeasured, 'ítems'),
        }))}
      />
    </ChartCard>
  )
}

function Breakdown({ title, subtitle, rows, idKey, names, unknown, countKey, countLabel, total, label, icon, tone }) {
  const named = rows.map((r) => ({ ...r, name: names.get(r[idKey]) ?? unknown }))
  return (
    <ChartCard
      title={title}
      icon={icon}
      tone={tone}
      subtitle={subtitle}
      table={
        named.length > 0 && {
          columns: [
            { key: 'name', label },
            { key: 'amount', label: 'Ventas', numeric: true },
            { key: 'share', label: 'Participación', numeric: true },
            { key: 'count', label: countLabel, numeric: true },
          ],
          rows: named.map((r) => ({
            key: r[idKey],
            cells: {
              name: r.name,
              amount: money(r.totalAmount),
              share: formatShare(r.totalAmount, total),
              count: formatCount(r[countKey]),
            },
          })),
        }
      }
    >
      <RankList
        summary={title}
        empty="Sin cuentas cerradas que repartir."
        rows={named.map((r) => ({
          key: r[idKey],
          name: r.name,
          value: r.totalAmount,
          primary: money(r.totalAmount),
          secondary: (
            <>
              <strong>{formatShare(r.totalAmount, total)}</strong> · {plural(r[countKey], countLabel.toLowerCase())}
            </>
          ),
        }))}
      />
    </ChartCard>
  )
}

function Sections({ data, names }) {
  const total = data.kpis.sales.value
  return (
    <div className="dash-grid">
      <SalesByDay rows={data.salesByDay} />
      <SalesByHour rows={data.salesByHour} />
      <TopProducts rows={data.topProducts} />
      <Preparation preparation={data.preparation} />
      <Breakdown
        title="Ventas por mesero"
        subtitle="Atribuidas a quien abrió la mesa"
        rows={data.waiterBreakdown}
        idKey="waiterId"
        names={names.people}
        unknown={UNKNOWN_WAITER}
        countKey="ordersCount"
        countLabel="Cuentas"
        label="Mesero"
        total={total}
        icon={Users}
        tone="raspberry"
      />
      <Breakdown
        title="Ventas por método de pago"
        subtitle="Según el método registrado en cada pago"
        rows={data.paymentBreakdown}
        idKey="paymentMethodId"
        names={names.methods}
        unknown={UNKNOWN_METHOD}
        countKey="paymentCount"
        countLabel="Pagos"
        label="Método"
        total={total}
        icon={CreditCard}
        tone="purple"
      />
    </div>
  )
}

// GC-RPT-0004. Dashboard de metricas del ADMIN. Mockup: Figma 12:2 "Admin — Dashboard", adaptado al design system
// (decision de la HU): los KPI son una franja tipografica partida por lineas de 1px, no tarjetas con icono; el rojo
// solo en marcas pequenas y series; un solo boton primario ("Aplicar"); cuadricula de 8 px. Todas las cifras las
// calcula el backend: aqui solo se formatean (R4).

const DELTA_ICON = { up: ArrowUp, down: ArrowDown }

// Una cifra de la franja: icono del tema (circulo teñido, como el mockup), etiqueta, valor, cambio frente al
// periodo anterior en una pastilla y el valor anterior. `lead` es la cifra principal (Ventas): mas grande.
function Kpi({ label, kpi, format, lowerIsBetter = false, note, icon: TopicIcon, tone, lead = false }) {
  const { value, previous, changePercent } = kpi
  const deltaKind = deltaTone(changePercent, { lowerIsBetter })
  const Icon = changePercent > 0 ? DELTA_ICON.up : changePercent < 0 ? DELTA_ICON.down : Minus
  const toneText = deltaKind === 'good' ? 'mejora' : deltaKind === 'bad' ? 'empeora' : 'sin cambio'
  return (
    <div className={`dash-kpi dash-tone--${tone}${lead ? ' dash-kpi--lead' : ''}`}>
      <p className="dash-kpi__label">
        <span className="dash-chip dash-chip--sm" aria-hidden="true">
          <TopicIcon size={16} />
        </span>
        {label}
      </p>
      <p className="dash-kpi__value">{value === null ? '—' : format(value)}</p>
      {changePercent === null ? (
        <p className="dash-delta dash-delta--neutral">
          <span aria-hidden="true">—</span> Sin periodo anterior
        </p>
      ) : (
        <p className={`dash-delta dash-delta--${deltaKind}`}>
          <Icon size={16} aria-hidden="true" />
          {formatPercent(changePercent)}
          <span className="sr-only"> ({toneText})</span>
        </p>
      )}
      <p className="dash-kpi__prev">
        vs {previous === null ? 'sin datos' : format(previous)}
        {note && <span className="dash-kpi__note"> · {note}</span>}
      </p>
    </div>
  )
}

// Resumen en una frase con lo importante en negrita: cuanto se vendio, el mejor dia, la hora pico y lo mas
// vendido. Solo lee las series del backend (R4): no calcula ningun total.
function Highlights({ data }) {
  const { kpis, salesByDay, salesByHour, topProducts } = data
  if (kpis.sales.value === 0) return null
  const day = peakOf(salesByDay)
  const hour = peakOf(salesByHour)
  const top = topProducts[0]
  return (
    <p className="dash-insight">
      Se vendieron <strong>{formatCOP(kpis.sales.value)}</strong> en{' '}
      <strong>{plural(kpis.orders.value, 'cuentas')}</strong>.
      {day && (
        <>
          {' '}
          El mejor día fue el{' '}
          <strong>
            {formatWeekday(day.date)} {formatShortDate(day.date)}
          </strong>
        </>
      )}
      {hour && (
        <>
          {day ? ' y la hora pico, ' : ' La hora pico fue '}
          <strong>{formatHourSlot(hour.hour)}</strong>
        </>
      )}
      {/* Cierra la oracion sin duplicar el punto de "p. m." */}
      {(day || hour) && !(hour && formatHourSlot(hour.hour).endsWith('.')) && '.'}
      {top && (
        <>
          {' '}
          Lo más vendido: <strong>{top.productName}</strong> ({plural(top.quantitySold, 'unidades', 'unidad')}).
        </>
      )}
    </p>
  )
}

function KpiStrip({ data }) {
  const { kpis, preparation } = data
  const empty = kpis.orders.value === 0 && preparation.itemsMeasured === 0
  return (
    <section className="dash-card dash-strip" aria-labelledby="dash-kpis-title">
      <h2 id="dash-kpis-title" className="sr-only">
        Indicadores del periodo
      </h2>
      <Highlights data={data} />
      <div className="dash-kpis">
        <Kpi label="Ventas" kpi={kpis.sales} format={formatCOP} icon={DollarSign} tone="red" lead />
        <Kpi label="Cuentas cerradas" kpi={kpis.orders} format={formatCount} icon={ReceiptText} tone="blue" />
        <Kpi label="Ticket promedio" kpi={kpis.averageTicket} format={formatCOP} icon={Wallet} tone="green" />
        <Kpi
          label="Tiempo de preparación"
          kpi={kpis.preparationMinutes}
          format={formatMinutes}
          lowerIsBetter
          note="menos es mejor"
          icon={Timer}
          tone="orange"
        />
      </div>
      {empty && (
        <p className="dash-strip__empty" role="status">
          Sin ventas en este periodo.
        </p>
      )}
      <details className="dash-help">
        <summary>Cómo se calculan estas cifras</summary>
        <dl>
          <dt>Ventas</dt>
          <dd>Suma de las cuentas cerradas, con descuentos aplicados e impuestos incluidos.</dd>
          <dt>Ticket promedio</dt>
          <dd>Ventas ÷ cuentas cerradas.</dd>
          <dt>Preparación</dt>
          <dd>
            Desde que el pedido llega a cocina hasta que el ítem está listo. Los ítems cancelados no cuentan; sí
            cuentan los de mesas que aún no pagan.
          </dd>
          <dt>Meseros</dt>
          <dd>Ventas atribuidas a quien abrió la mesa.</dd>
          <dt>Fechas</dt>
          <dd>
            Cada venta cuenta el día y la hora en que se cobró. Las cifras son en vivo: si se corrige algo después de
            un cierre de caja, aquí se ve la corrección.
          </dd>
        </dl>
      </details>
    </section>
  )
}

function StripSkeleton() {
  return (
    <div className="dash-card dash-strip" aria-hidden="true">
      <div className="dash-kpis">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="dash-kpi">
            <span className="dash-skel dash-skel--label" />
            <span className="dash-skel dash-skel--value" />
            <span className="dash-skel dash-skel--label" />
          </div>
        ))}
      </div>
    </div>
  )
}

// "Semana en curso (faltan 2 días)" / "Semana pasada" / "Periodo personalizado"
function periodLabel(presetId, period, today) {
  const preset = PRESETS.find((p) => p.id === presetId)
  if (!preset) return 'Periodo personalizado'
  const left = remainingDays(period, today)
  const name = presetId === 'week' ? 'Semana en curso' : presetId === 'month' ? 'Mes en curso' : preset.label
  if (left === 0) return name
  return `${name} (${left === 1 ? 'falta 1 día' : `faltan ${left} días`})`
}

function PeriodPicker({ presetId, onPreset, from, to, onFrom, onTo, onApply, error, busy }) {
  return (
    <div className="dash-picker">
      <div className="dash-presets" role="group" aria-label="Periodo">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`btn btn--ghost dash-preset${presetId === p.id ? ' dash-preset--on' : ''}`}
            aria-pressed={presetId === p.id}
            onClick={() => onPreset(p)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <form
        className="dash-custom"
        onSubmit={(event) => {
          event.preventDefault()
          onApply()
        }}
        noValidate
      >
        <label className="field dash-date">
          <span className="field__label">Desde</span>
          <input
            type="date"
            className="field__input"
            value={from}
            onChange={(e) => onFrom(e.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'dash-range-error' : undefined}
          />
        </label>
        <label className="field dash-date">
          <span className="field__label">Hasta</span>
          <input
            type="date"
            className="field__input"
            value={to}
            onChange={(e) => onTo(e.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'dash-range-error' : undefined}
          />
        </label>
        <button type="submit" className="btn btn--primary" disabled={busy}>
          Aplicar
        </button>
        {error && (
          <p id="dash-range-error" className="field__error dash-range-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  )
}

export default function DashboardPage() {
  const today = useMemo(() => businessToday(), [])
  const initial = useMemo(() => PRESETS[0].range(today), [today])
  const [presetId, setPresetId] = useState('week')
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [rangeError, setRangeError] = useState('')
  const dash = useDashboard(initial)
  const names = useNames()

  const choosePreset = (preset) => {
    const range = preset.range(today)
    setPresetId(preset.id)
    setFrom(range.from)
    setTo(range.to)
    setRangeError('')
    dash.setRange(range)
  }

  // Validacion antes de enviar: un rango invalido no llega al servidor
  const applyCustom = () => {
    const error = validateRange(from, to)
    setRangeError(error)
    if (error) return
    const preset = PRESETS.find((p) => {
      const r = p.range(today)
      return r.from === from && r.to === to
    })
    setPresetId(preset?.id ?? 'custom')
    dash.setRange({ from, to })
  }

  const { data } = dash

  return (
    <AdminPage title="Dashboard">
      <div className="dash" aria-busy={dash.status === 'loading' || dash.refreshing}>
        <PeriodPicker
          presetId={presetId}
          onPreset={choosePreset}
          from={from}
          to={to}
          onFrom={setFrom}
          onTo={setTo}
          onApply={applyCustom}
          error={rangeError}
          busy={dash.refreshing}
        />

        <p className="dash-period" aria-live="polite">
          {data ? (
            <>
              <strong>{formatRange(data.period)}</strong>
              {' · '}
              {periodLabel(presetId, data.period, today)}
              {' · comparado con '}
              {formatRange(data.previousPeriod)}
              {dash.refreshing && <span className="dash-period__busy"> · Actualizando…</span>}
            </>
          ) : (
            'Cargando métricas…'
          )}
        </p>

        {dash.status === 'error' && (
          <div className="catalog-state catalog-state--card" role="alert">
            <TriangleAlert size={24} aria-hidden="true" />
            <p>{dash.error}</p>
            <button type="button" className="btn btn--ghost" onClick={dash.reload}>
              <RefreshCw size={16} aria-hidden="true" /> Reintentar
            </button>
          </div>
        )}

        {dash.status === 'ready' && dash.error && (
          <div className="dash-inline-error" role="alert">
            <TriangleAlert size={16} aria-hidden="true" />
            <span>
              {dash.error} Se siguen mostrando las cifras de {formatRange(data.period)}.
            </span>
            <button type="button" className="dash-link" onClick={dash.reload}>
              Reintentar
            </button>
          </div>
        )}

        {dash.status === 'loading' && <StripSkeleton />}
        {data && <KpiStrip data={data} />}
        {data && <Sections data={data} names={names} />}

        <p className="dash-foot">Días de negocio en hora de Colombia (UTC−5).</p>
      </div>
    </AdminPage>
  )
}
