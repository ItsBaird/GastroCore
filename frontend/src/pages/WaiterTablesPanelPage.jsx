import { BellRing, RefreshCw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listTableStatuses, openTable as openTableApi } from '../api/tablesStatus.js'
import { useAuth } from '../auth/useAuth.js'
import '../components/TableCards.css'
import { TableStats } from '../components/TableStats.jsx'
import { useTableStatusSocket } from '../hooks/useTableStatusSocket.js'
import { WaiterPage } from '../layouts/WaiterLayout.jsx'
import '../styles/waiter.tokens.css'
import { sortForSection, TABLE_SECTIONS, TABLE_STATUS } from '../utils/waiterTables.js'
import './WaiterTablesPanelPage.css'

// Mis Mesas (Figma 31:2 "Mesero - Mis Mesas"). La misma organizacion en escritorio, tablet y movil: resumen
// arriba y las mesas divididas por estado. En Ocupadas y En cobro van primero las del mesero de la sesion; las de
// un compañero se ven con una sombra encima y sin accion (el backend responderia 403). El ADMIN puede operarlas.
const STATUS_CONFIG = TABLE_STATUS
const SECTIONS = TABLE_SECTIONS

function SkeletonCards() {
  return Array.from({ length: 8 }, (_, i) => (
    <div key={i} className="ts-card ts-card--skeleton" aria-hidden="true" />
  ))
}

// Una sola fuente para "que accion toca segun el estado"
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
          // Contorno azul, como "Abrir Mesa": se distingue de "Tomar Pedido" (azul lleno)
          className: 'ts-btn--detalle',
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

// Tarjeta de mesa (Figma 31:64 libre, 152:7 ocupada propia, 152:19 ocupada de un compañero, 152:37 en cobro)
function TableCard({ table, isMe, isAdmin, onOpen, opening, onCharge, onViewDetail, onTakeOrder }) {
  const config = STATUS_CONFIG[table.status] ?? STATUS_CONFIG.libre
  const isColleagues = table.status !== 'libre' && !isMe
  // La mesa de un compañero se ve pero no se opera (el ADMIN si puede)
  const locked = isColleagues && !isAdmin
  const action = locked
    ? null
    : tableAction(table, { onOpen, opening, onCharge, onViewDetail, onTakeOrder })
  const calls = table.pendingCalls?.length ?? 0

  return (
    <article
      className={`ts-card ${config.className}${locked ? ' ts-card--locked' : ''}`}
      aria-label={`Mesa ${table.tableNumber}, ${config.label}${locked ? ', de otro mesero' : ''}`}
    >
      <div className="ts-card__top-bar" />
      <div className="ts-card__header">
        <span className="ts-card__name">
          Mesa <span className="ts-card__number">{table.tableNumber}</span>
        </span>
        <span className={`pill pill--table-${table.status}`}>{config.label}</span>
      </div>
      <div className="ts-card__divider" />
      <div className="ts-card__body">
        {table.status !== 'libre' && (
          <p className="ts-card__attendant">
            Atiende:
            {/* En movil la tarjeta es angosta: un nombre largo se recorta con "…" y queda completo en el title */}
            <span className="ts-card__waiter" title={isMe ? undefined : (table.waiterName ?? undefined)}>
              {isMe ? 'Tú' : (table.waiterName ?? 'otro mesero')}
            </span>
          </p>
        )}
        {/* Llamado del cliente: etiqueta como la del estado, pero llena en rojo (el rojo de "Llamados") para que no
            se confunda con el naranja de "En cobro". Lleva icono: no depende solo del color */}
        {calls > 0 && (
          <span className="ts-card__calls">
            <BellRing size={12} aria-hidden="true" />
            {calls} llamado{calls > 1 ? 's' : ''}
          </span>
        )}
      </div>
      <div className="ts-card__actions">
        {action && (
          <button
            type="button"
            className={`btn ${action.className}`}
            aria-label={action.ariaLabel}
            disabled={action.disabled}
            onClick={action.run}
          >
            {action.label}
          </button>
        )}
      </div>
      {/* Sombra encima de la mesa de un compañero: se ve, pero no esta disponible */}
      {locked && <div className="ts-card__shade" aria-hidden="true" />}
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

  const cardProps = (t) => ({
    table: t,
    isMe: t.waiterId === user?.userId,
    isAdmin: user?.role === 'ADMIN',
    onOpen: handleOpen,
    opening: openingId === t.tableId,
    onCharge: handleCharge,
    onViewDetail: handleViewDetail,
    onTakeOrder: handleTakeOrder,
  })

  return (
    <WaiterPage title="Mis Mesas">
      {status === 'ready' && <TableStats tables={tables} />}

      {openError && (
        <div className="ts-open-error" role="alert">
          <TriangleAlert size={16} />
          <span>{openError}</span>
          <button type="button" className="btn btn--ghost" onClick={() => setOpenError('')}>
            Cerrar
          </button>
        </div>
      )}

      {status === 'error' ? (
        <div className="ts-state" role="alert">
          <TriangleAlert size={28} />
          <p>{error}</p>
          <button type="button" className="btn btn--ghost" onClick={retry}>
            <RefreshCw size={16} /> Reintentar
          </button>
        </div>
      ) : status === 'loading' ? (
        <div className="ts-grid" aria-busy="true" aria-label="Cargando mesas">
          <SkeletonCards />
        </div>
      ) : tables.length === 0 ? (
        <div className="ts-state">
          <p>No hay mesas registradas.</p>
        </div>
      ) : (
        SECTIONS.map((section) => {
          const rows = sortForSection(tables, section.status, user?.userId)
          const titleId = `ts-section-${section.status}`
          return (
            <section key={section.status} className="ts-section" aria-labelledby={titleId}>
              <h2 id={titleId} className="ts-section-title">
                {section.title}
              </h2>
              {rows.length === 0 ? (
                <p className="ts-section-empty">{section.empty}</p>
              ) : (
                <div className="ts-grid">
                  {rows.map((t) => (
                    <TableCard key={t.tableId} {...cardProps(t)} />
                  ))}
                </div>
              )}
            </section>
          )
        })
      )}
    </WaiterPage>
  )
}
