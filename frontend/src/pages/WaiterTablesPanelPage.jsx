import { CircleDollarSign, RefreshCw, Table, TriangleAlert, UtensilsCrossed } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { listTableStatuses, openTable as openTableApi } from '../api/tablesStatus.js'
import { useAuth } from '../auth/useAuth.js'
import { useToast } from '../components/Toast.jsx'
import { useTableStatusSocket } from '../hooks/useTableStatusSocket.js'
import { WaiterPage } from '../layouts/WaiterLayout.jsx'
import '../styles/waiter.tokens.css'
import './WaiterTablesPanelPage.css'

const STATUS_CONFIG = {
  libre: { label: 'Libre', className: 'ts-card--libre' },
  ocupada: { label: 'Ocupada', className: 'ts-card--ocupada' },
  en_cobro: { label: 'En Cobro', className: 'ts-card--en-cobro' },
}

function SkeletonCards() {
  return Array.from({ length: 8 }, (_, i) => (
    <div key={i} className="ts-card ts-card--skeleton" aria-hidden="true" />
  ))
}

function StatCards({ tables }) {
  const libre = tables.filter((t) => t.status === 'libre').length
  const ocupada = tables.filter((t) => t.status === 'ocupada').length
  const enCobro = tables.filter((t) => t.status === 'en_cobro').length

  return (
    <div className="ts-stats" role="group" aria-label="Resumen de mesas">
      <div className="ts-stat ts-stat--asignadas">
        <div className="ts-stat__bar" />
        <div className="ts-stat__info">
          <span className="ts-stat__value">{tables.length}</span>
          <span className="ts-stat__label">Asignadas</span>
        </div>
        <div className="ts-stat__circle" aria-hidden="true">
          <Table size={18} />
        </div>
      </div>
      <div className="ts-stat ts-stat--libre">
        <div className="ts-stat__bar" />
        <div className="ts-stat__info">
          <span className="ts-stat__value">{libre}</span>
          <span className="ts-stat__label">Libres</span>
        </div>
        <div className="ts-stat__circle" aria-hidden="true">
          <Table size={18} />
        </div>
      </div>
      <div className="ts-stat ts-stat--ocupada">
        <div className="ts-stat__bar" />
        <div className="ts-stat__info">
          <span className="ts-stat__value">{ocupada}</span>
          <span className="ts-stat__label">Ocupadas</span>
        </div>
        <div className="ts-stat__circle" aria-hidden="true">
          <UtensilsCrossed size={18} />
        </div>
      </div>
      <div className="ts-stat ts-stat--en-cobro">
        <div className="ts-stat__bar" />
        <div className="ts-stat__info">
          <span className="ts-stat__value">{enCobro}</span>
          <span className="ts-stat__label">En Cobro</span>
        </div>
        <div className="ts-stat__circle" aria-hidden="true">
          <CircleDollarSign size={18} />
        </div>
      </div>
    </div>
  )
}

function TableCard({ table, isMe, onOpen, opening, onComingSoon }) {
  const config = STATUS_CONFIG[table.status] ?? STATUS_CONFIG.libre

  return (
    <article className={`ts-card ${config.className}`}>
      <div className="ts-card__top-bar" />
      <div className="ts-card__header">
        <div className="ts-card__circle">{table.tableNumber}</div>
        <div className="ts-card__title-group">
          <span className="ts-card__number">Mesa {table.tableNumber}</span>
        </div>
        <div className="ts-card__pill-wrap">
          <span className={`pill pill--table-${table.status}`}>{config.label}</span>
        </div>
      </div>
      <div className="ts-card__divider" />
      <div className="ts-card__body">
        {isMe && <span className="ts-card__waiter">Tú</span>}
        {table.pendingCalls.length > 0 && (
          <span className="ts-card__calls">
            {table.pendingCalls.length} llamado{table.pendingCalls.length > 1 ? 's' : ''}
          </span>
        )}
      </div>
      <div className="ts-card__actions">
        {table.status === 'libre' && (
          <button
            type="button"
            className="btn ts-btn--libre"
            disabled={opening}
            onClick={() => onOpen(table.tableId)}
          >
            {opening ? 'Abriendo…' : 'Abrir Mesa'}
          </button>
        )}
        {table.status === 'ocupada' && (
          <button
            type="button"
            className="btn ts-btn--ocupada"
            onClick={() => onComingSoon('Ver Detalle disponible próximamente')}
          >
            Ver Detalle
          </button>
        )}
        {table.status === 'en_cobro' && (
          <button
            type="button"
            className="btn ts-btn--en-cobro"
            onClick={() => onComingSoon('Cobrar disponible próximamente')}
          >
            Cobrar
          </button>
        )}
      </div>
    </article>
  )
}

export default function WaiterTablesPanelPage() {
  const { user } = useAuth()
  const toast = useToast()
  const [{ status, tables, error }, setData] = useState({ status: 'loading', tables: [], error: '' })
  const [openingId, setOpeningId] = useState(null)
  const [openError, setOpenError] = useState('')

  const fetchStatuses = useCallback(async () => {
    try {
      return { status: 'ready', tables: await listTableStatuses(), error: '' }
    } catch {
      return { status: 'error', tables: [], error: 'No se pudo cargar el estado de las mesas.' }
    }
  }, [])

  useEffect(() => {
    let active = true
    fetchStatuses().then((result) => active && setData(result))
    return () => {
      active = false
    }
  }, [fetchStatuses])

  const retry = () => {
    setData((d) => ({ ...d, status: 'loading', error: '' }))
    fetchStatuses().then(setData)
  }

  const handleOpen = async (tableId) => {
    setOpeningId(tableId)
    setOpenError('')
    try {
      const order = await openTableApi(tableId)
      setData((prev) => {
        const next = prev.tables.map((t) =>
          t.tableId === tableId
            ? { ...t, status: 'ocupada', orderId: order.orderId, waiterId: order.waiterId }
            : t,
        )
        return { ...prev, tables: next }
      })
    } catch (err) {
      setOpenError(err?.message || 'No se pudo abrir la mesa.')
    } finally {
      setOpeningId(null)
    }
  }

  const handleComingSoon = (msg) => {
    toast.success(msg)
  }

  useTableStatusSocket((updated) => {
    setData((prev) => {
      if (prev.status !== 'ready') return prev
      const idx = prev.tables.findIndex((t) => t.tableId === updated.tableId)
      if (idx === -1) return prev
      const next = [...prev.tables]
      next[idx] = updated
      return { ...prev, tables: next }
    })
  })

  return (
    <WaiterPage title="Mis Mesas">
      {status === 'ready' && <StatCards tables={tables} />}

      {openError && (
        <div className="ts-open-error" role="alert">
          <TriangleAlert size={16} />
          <span>{openError}</span>
          <button type="button" className="btn btn--ghost" onClick={() => setOpenError('')}>Cerrar</button>
        </div>
      )}

      <h2 className="ts-section-title">Mis Mesas Asignadas</h2>

      <section className="ts-panel" aria-label="Estado de mesas">
        {status === 'error' ? (
          <div className="ts-state" role="alert">
            <TriangleAlert size={28} />
            <p>{error}</p>
            <button type="button" className="btn btn--ghost" onClick={retry}>
              <RefreshCw size={16} /> Reintentar
            </button>
          </div>
        ) : status === 'ready' && tables.length === 0 ? (
          <div className="ts-state">
            <p>No hay mesas registradas.</p>
          </div>
        ) : (
          <div className="ts-grid">
            {status === 'loading' ? (
              <SkeletonCards />
            ) : (
              tables.map((t) => (
                <TableCard
                  key={t.tableId}
                  table={t}
                  isMe={t.waiterId === user?.userId}
                  onOpen={handleOpen}
                  opening={openingId === t.tableId}
                  onComingSoon={handleComingSoon}
                />
              ))
            )}
          </div>
        )}
      </section>
    </WaiterPage>
  )
}
