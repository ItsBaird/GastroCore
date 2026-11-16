import { useId, useState } from 'react'
import { barPercent, niceScale } from '../utils/dashboard.js'
import './DashboardCharts.css'

// GC-RPT-0004. Graficas del dashboard sin librerias (package.json es protegido): HTML y CSS con los tokens.
// Reglas (skills dataviz y design-taste/app-screens): una sola serie y un solo tono por grafica, sin leyenda; escala
// desde 0 con 4-5 marcas redondas; barras de esquinas rectas; la marca destacada (el maximo) en el tono fuerte y con
// su valor escrito; los textos en tinta de texto, nunca en el color de la serie; cada grafica con un resumen en texto
// (role="img") y una tabla real a un clic. Todas las cifras vienen del backend: aqui solo se dibujan.
//
// Tono por tema (DashboardCharts.css): rojo tomate para las ventas en el tiempo,
// naranja horno para los productos, mostaza (queso) para la cocina, frambuesa para meseros
// y violeta (pastilla ADMIN) para los pagos. `tone` acepta: red, orange, mustard, raspberry, purple (y blue/green,
// solo para los iconos de la franja de KPI).

// Tarjeta de una grafica o listado con el control "Ver como tabla"
export function ChartCard({ title, subtitle, note, table, children, icon: Icon, tone = 'red' }) {
  const id = useId()
  const [asTable, setAsTable] = useState(false)
  return (
    <section className={`dash-card dash-chart dash-tone--${tone}`} aria-labelledby={`${id}-title`}>
      <header className="dash-chart__head">
        {Icon && (
          <span className="dash-chip" aria-hidden="true">
            <Icon size={20} />
          </span>
        )}
        <div className="dash-chart__heading">
          <h2 id={`${id}-title`} className="dash-chart__title">
            {title}
          </h2>
          {subtitle && <p className="dash-chart__sub">{subtitle}</p>}
        </div>
        {table && (
          <button
            type="button"
            className="dash-link dash-chart__toggle"
            aria-pressed={asTable}
            onClick={() => setAsTable((v) => !v)}
          >
            {asTable ? 'Ver gráfica' : 'Ver como tabla'}
          </button>
        )}
      </header>
      {note}
      {asTable && table ? <DataTable caption={title} {...table} /> : children}
    </section>
  )
}

// Tabla alternativa: <caption> y encabezados con scope; numeros alineados a la derecha
export function DataTable({ caption, columns, rows }) {
  return (
    <div className="dash-table-wrap">
      <table className="dash-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.numeric ? 'dash-num' : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              {columns.map((c, i) =>
                i === 0 ? (
                  <th key={c.key} scope="row">
                    {row.cells[c.key]}
                  </th>
                ) : (
                  <td key={c.key} className={c.numeric ? 'dash-num' : undefined}>
                    {row.cells[c.key]}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Columnas por periodo (dias u horas). `items`: [{ key, label, axisLabel, value, display }]. `labelEvery` rotula
// una de cada N en el eje (las demas se leen en el tooltip o en la tabla). Un periodo sin ventas dibuja la linea base
// y las marcas, sin barras: nunca NaN ni alturas negativas.
export function ColumnChart({ items, summary, highlightKey, labelEvery = 1, formatTick }) {
  const max = items.reduce((m, i) => Math.max(m, i.value), 0)
  const scale = niceScale(max)
  return (
    <div className="dash-columns">
      <div className="dash-columns__body" role="img" aria-label={summary}>
        <div className="dash-columns__axis" aria-hidden="true">
          {scale.ticks.map((t) => (
            <span key={t} style={{ bottom: `${barPercent(t, scale.max)}%` }}>
              {formatTick(t)}
            </span>
          ))}
        </div>
        <div className="dash-columns__plot">
          {scale.ticks.map((t) => (
            <span
              key={t}
              className={`dash-columns__grid${t === 0 ? ' dash-columns__grid--base' : ''}`}
              style={{ bottom: `${barPercent(t, scale.max)}%` }}
              aria-hidden="true"
            />
          ))}
          <div className="dash-columns__bars" style={{ '--count': items.length }}>
            {items.map((i) => {
              const hi = i.key === highlightKey
              return (
                <div key={i.key} className="dash-col" title={`${i.label}: ${i.display}`}>
                  <span
                    className={`dash-col__bar${hi ? ' dash-col__bar--hi' : ''}`}
                    style={{ height: `${barPercent(i.value, scale.max)}%` }}
                  >
                    {/* El maximo lleva su valor escrito encima: se lee sin pasar el mouse */}
                    {hi && (
                      <span className="dash-col__value" aria-hidden="true">
                        {formatTick(i.value)}
                      </span>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <div className="dash-columns__x" style={{ '--count': items.length }} aria-hidden="true">
        {/* En movil se oculta una de cada dos etiquetas (dash-x--alt): la columna es angosta para todas */}
        {items.map((i, index) => {
          const labelled = index % labelEvery === 0
          const alt = labelled && (index / labelEvery) % 2 === 1
          return (
            <span key={i.key} className={alt ? 'dash-x--alt' : undefined}>
              {labelled ? i.axisLabel : ''}
            </span>
          )
        })}
      </div>
    </div>
  )
}

// Ranking con barra horizontal (mejor legibilidad que una torta). `rows`: [{ key, name, value, primary, secondary }];
// la barra es la proporcion frente al mayor de la lista, en el tono de la tarjeta. El primero (el lider) va
// destacado. `numbered` agrega la posicion en una insignia.
export function RankList({ rows, summary, empty, numbered = false }) {
  if (rows.length === 0) return <p className="dash-empty">{empty}</p>
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0)
  return (
    <ol className="dash-rank" aria-label={summary}>
      {rows.map((r, index) => (
        <li key={r.key} className={`dash-rank__row${index === 0 ? ' dash-rank__row--lead' : ''}`}>
          <div className="dash-rank__top">
            {numbered && (
              <span className="dash-rank__pos" aria-hidden="true">
                {index + 1}
              </span>
            )}
            <span className="dash-rank__name" title={r.name}>
              {r.name}
            </span>
            <span className="dash-rank__value">{r.primary}</span>
          </div>
          <span className="dash-rank__track" aria-hidden="true">
            <span className="dash-rank__bar" style={{ width: `${barPercent(r.value, max)}%` }} />
          </span>
          {r.secondary && <span className="dash-rank__sub">{r.secondary}</span>}
        </li>
      ))}
    </ol>
  )
}
