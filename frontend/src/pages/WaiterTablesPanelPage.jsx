import { CircleDollarSign, RefreshCw, Table, TriangleAlert, UtensilsCrossed } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listTableStatuses, openTable as openTableApi } from '../api/tablesStatus.js'
import { useAuth } from '../auth/useAuth.js'
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

// Una sola fuente para "que accion toca segun el estado": la usan el boton de escritorio y
// la fila completa en movil, donde el Figma (40:2) no dibuja boton y la fila es el objetivo.
function tableAction(table, { onOpen, opening, onCharge, onViewDetail, onTakeOrder }) {
  const mesa = `Mesa ${table.tableNumber}`

  if (table.status === 'libre') {
    return {
      label: opening ? 'Abriendo…' : 'Abrir Mesa',
      className: 'ts-btn--libre',
      ariaLabel: `${mesa}, abrir mesa`,
      disabled: opening,
      run: () => onOpen(table.tableId),
    }
  }
  if (table.status === 'ocupada') {
    return table.itemsCount > 0
      ? {
          label: 'Ver Detalle',
          className: 'ts-btn--ocupada',
          ariaLabel: `${mesa}, ver detalle`,
          disabled: false,
          run: () => onViewDetail(table),
        }
      : {
          label: 'Tomar Pedido',
          className: 'ts-btn--ocupada',
          ariaLabel: `${mesa}, tomar pedido`,
          disabled: false,
          run: () => onTakeOrder(table),
        }
  }
  if (table.status === 'en_cobro') {
    return {
      label: 'Cobrar',
      className: 'ts-btn--en-cobro',
      ariaLabel: `${mesa}, cobrar`,
      disabled: false,
      run: () => onCharge(table),
    }
  }
  return null
}

function TableCard({
  table,
  isMe,
  isAdmin,
  onOpen,
  opening,
  onCharge,
  onViewDetail,
  onTakeOrder,
}) {
  const config = STATUS_CONFIG[table.status] ?? STATUS_CONFIG.libre
  // La mesa de un compañero se ve pero no se opera: el backend responderia 403
  const isColleagues = table.status !== 'libre' && !isMe
  const action =
    isColleagues && !isAdmin
      ? null
      : tableAction(table, { onOpen, opening, onCharge, onViewDetail, onTakeOrder })

  return (
    <article className={`ts-card ${config.className}`}>
      {/* Objetivo tactil de la fila en movil: ahi el boton de acciones se oculta. Es un
          <button> real, asi que trae teclado y foco sin reimplementarlos. */}
      {action && (
        <button
          type="button"
          className="ts-card__tap"
          aria-label={action.ariaLabel}
          disabled={action.disabled}
          onClick={action.run}
        />
      )}
      <div className="ts-card__top-bar" />
      <div className="ts-card__header">
        <div className="ts-card__circle">{table.tableNumber}</div>
        <div className="ts-card__title-group">
          <span className="ts-card__number">Mesa {table.tableNumber}</span>
          {isColleagues && (
            <span className="ts-card__attendant">
              Atiende: {table.waiterName ?? 'otro mesero'}
            </span>
          )}
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
        {action && (
          <button
            type="button"
            className={`btn ${action.className}`}
            disabled={action.disabled}
            onClick={action.run}
          >
            {action.label}
          </button>
        )}
      </div>
    </article>
  )
}

export default function WaiterTablesPanelPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
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
      // Un compañero la abrio primero: el panel que se ve aqui quedo viejo
      if (err?.code === 'TABLE_ALREADY_OPEN') fetchStatuses().then(setData)
    } finally {
      setOpeningId(null)
    }
  }

  // GC-ORD-0006: la mesa en cobro abre su cuenta (GET /bill es idempotente con la mesa ya en cobro)
  const handleCharge = (table) => {
    navigate(`/mesero/mesas/${table.orderId}/cobro`)
  }

  const handleViewDetail = (table) => {
    navigate(`/mesero/mesas/${table.orderId}`)
  }

  const handleTakeOrder = (table) => {
    navigate(`/mesero/mesas/${table.orderId}/nueva-ronda`, {
      state: { tableNumber: table.tableNumber },
    })
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
                  isAdmin={user?.role === 'ADMIN'}
                  onOpen={handleOpen}
                  opening={openingId === t.tableId}
                  onCharge={handleCharge}
                  onViewDetail={handleViewDetail}
                  onTakeOrder={handleTakeOrder}
                />
              ))
            )}
          </div>
        )}
      </section>
    </WaiterPage>
  )
}
