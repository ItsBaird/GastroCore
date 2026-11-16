import { ArrowDown, ArrowUp, Minus, RefreshCw, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useDashboard } from '../hooks/useDashboard.js'
import { AdminPage } from '../layouts/AdminLayout.jsx'
import {
  businessToday,
  deltaTone,
  formatCount,
  formatMinutes,
  formatPercent,
  formatRange,
  PRESETS,
  remainingDays,
  validateRange,
} from '../utils/dashboard.js'
import { formatCOP } from '../utils/formatCOP.js'
import './CatalogPages.css'
import './DashboardPage.css'

// GC-RPT-0004. Dashboard de metricas del ADMIN. Mockup: Figma 12:2 "Admin — Dashboard", adaptado al design system
// (decision de la HU): los KPI son una franja tipografica partida por lineas de 1px, no tarjetas con icono; el rojo
// solo en marcas pequenas y series; un solo boton primario ("Aplicar"); cuadricula de 8 px. Todas las cifras las
// calcula el backend: aqui solo se formatean (R4).

const DELTA_ICON = { up: ArrowUp, down: ArrowDown }

// Una cifra de la franja: etiqueta, valor, cambio frente al periodo anterior y el valor anterior
function Kpi({ label, kpi, format, lowerIsBetter = false, note }) {
  const { value, previous, changePercent } = kpi
  const tone = deltaTone(changePercent, { lowerIsBetter })
  const Icon = changePercent > 0 ? DELTA_ICON.up : changePercent < 0 ? DELTA_ICON.down : Minus
  const toneText = tone === 'good' ? 'mejora' : tone === 'bad' ? 'empeora' : 'sin cambio'
  return (
    <div className="dash-kpi">
      <p className="dash-kpi__label">{label}</p>
      <p className="dash-kpi__value">{value === null ? '—' : format(value)}</p>
      {changePercent === null ? (
        <p className="dash-delta dash-delta--neutral">
          <span aria-hidden="true">—</span> Sin periodo anterior
        </p>
      ) : (
        <p className={`dash-delta dash-delta--${tone}`}>
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

function KpiStrip({ data }) {
  const { kpis, preparation } = data
  const empty = kpis.orders.value === 0 && preparation.itemsMeasured === 0
  return (
    <section className="dash-card dash-strip" aria-labelledby="dash-kpis-title">
      <h2 id="dash-kpis-title" className="sr-only">
        Indicadores del periodo
      </h2>
      <div className="dash-kpis">
        <Kpi label="Ventas" kpi={kpis.sales} format={formatCOP} />
        <Kpi label="Cuentas cerradas" kpi={kpis.orders} format={formatCount} />
        <Kpi label="Ticket promedio" kpi={kpis.averageTicket} format={formatCOP} />
        <Kpi
          label="Tiempo de preparación"
          kpi={kpis.preparationMinutes}
          format={formatMinutes}
          lowerIsBetter
          note="menos es mejor"
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

        <p className="dash-foot">Días de negocio en hora de Colombia (UTC−5).</p>
      </div>
    </AdminPage>
  )
}
