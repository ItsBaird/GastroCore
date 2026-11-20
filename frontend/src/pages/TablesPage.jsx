import { BellRing, Check, Copy, Pencil, Plus, QrCode, RefreshCw, TriangleAlert, UserRoundPen } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { createTable, listTables, reassignTable, updateTable } from '../api/tables.js'
import { listTableStatuses } from '../api/tablesStatus.js'
import { useAuth } from '../auth/useAuth.js'
import '../components/TableCards.css'
import { TableStats } from '../components/TableStats.jsx'
import { useToast } from '../components/Toast.jsx'
import { useTableStatusSocket } from '../hooks/useTableStatusSocket.js'
import { AdminPage } from '../layouts/AdminLayout.jsx'
import { sortForSection, TABLE_SECTIONS, TABLE_STATUS } from '../utils/waiterTables.js'
import { QrPrintModal } from './QrPrintModal.jsx'
import { ReassignTableModal } from './ReassignTableModal.jsx'
import { TableFormModal } from './TableFormModal.jsx'
import './TablesPage.css'

// Gestion de Mesas del ADMIN con la misma organizacion que "Mis Mesas" del mesero (Figma 31:2): resumen arriba y
// las mesas divididas por estado, con la misma tarjeta. En Ocupadas y En cobro van primero las que atiende el propio
// ADMIN. La tarjeta conserva lo propio de la gestion: ruta y codigo QR, Editar y Reasignar. El ADMIN opera todas las
// mesas, asi que ninguna lleva sombra.

function SkeletonCards() {
  return Array.from({ length: 8 }, (_, i) => (
    <div key={i} className="ts-card ts-card--skeleton" aria-hidden="true" />
  ))
}

function AdminTableCard({ table, copied, onCopy, onQr, onEdit, onReassign }) {
  const config = TABLE_STATUS[table.status]
  const isOpen = table.status === 'ocupada' || table.status === 'en_cobro'
  const calls = table.pendingCalls?.length ?? 0

  return (
    <article
      className={`ts-card ${config?.className ?? ''}`}
      aria-label={`Mesa ${table.tableNumber}${config ? `, ${config.label}` : ''}`}
    >
      <div className="ts-card__top-bar" />
      <div className="ts-card__header">
        <span className="ts-card__name">
          Mesa <span className="ts-card__number">{table.tableNumber}</span>
        </span>
        {config && <span className={`pill pill--table-${table.status}`}>{config.label}</span>}
      </div>
      <div className="ts-card__divider" />
      <div className="ts-card__body">
        {isOpen && (
          <p className="ts-card__attendant">
            Atiende:
            <span className="ts-card__waiter" title={table.waiterName ?? undefined}>
              {table.waiterName ?? 'otro mesero'}
            </span>
          </p>
        )}
        {calls > 0 && (
          <span className="ts-card__calls">
            <BellRing size={12} aria-hidden="true" />
            {calls} llamado{calls > 1 ? 's' : ''}
          </span>
        )}
        <div className="tm-qr">
          <code className="tm-qr__path" title={`/m/${table.qrToken}`}>
            /m/{table.qrToken}
          </code>
          <button
            type="button"
            className="tm-icon-btn"
            onClick={onCopy}
            aria-label={`Copiar ruta QR de la mesa ${table.tableNumber}`}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
          <button
            type="button"
            className="tm-icon-btn"
            onClick={onQr}
            aria-label={`Ver código QR de la mesa ${table.tableNumber}`}
            title="Ver e imprimir el código QR"
          >
            <QrCode size={16} />
          </button>
        </div>
      </div>
      <div className="ts-card__actions tm-actions">
        <button
          type="button"
          className="tm-btn"
          onClick={onEdit}
          aria-label={`Editar mesa ${table.tableNumber}`}
        >
          <Pencil size={14} aria-hidden="true" />
          Editar
        </button>
        {isOpen && (
          <button
            type="button"
            className="tm-btn"
            onClick={onReassign}
            aria-label={`Reasignar mesa ${table.tableNumber}`}
          >
            <UserRoundPen size={14} aria-hidden="true" />
            Reasignar
          </button>
        )}
      </div>
    </article>
  )
}

export default function TablesPage() {
  const toast = useToast()
  const { user } = useAuth()
  const [{ status, tables, error }, setData] = useState({
    status: 'loading',
    tables: [],
    error: '',
  })
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(null)
  const [copiedId, setCopiedId] = useState(null)
  // null mientras carga; {} si fallo (las mesas se siguen mostrando y gestionando, sin dividir por estado)
  const [statuses, setStatuses] = useState(null)
  const [statusesFailed, setStatusesFailed] = useState(false)
  const [reassigning, setReassigning] = useState(null)
  // QR imprimible de la mesa (descargar PNG o imprimir)
  const [printingQr, setPrintingQr] = useState(null)

  // El estado es informativo: si falla, las mesas se siguen pudiendo crear y editar
  const fetchStatuses = useCallback(async () => {
    try {
      const list = await listTableStatuses()
      return { map: Object.fromEntries(list.map((s) => [s.tableId, s])), failed: false }
    } catch {
      return { map: {}, failed: true }
    }
  }, [])

  const applyStatuses = useCallback(({ map, failed }) => {
    setStatuses(map)
    setStatusesFailed(failed)
  }, [])

  useEffect(() => {
    let active = true
    fetchStatuses().then((result) => active && applyStatuses(result))
    return () => {
      active = false
    }
  }, [fetchStatuses, applyStatuses])

  useTableStatusSocket((updated) => {
    setStatuses((current) => ({ ...(current ?? {}), [updated.tableId]: updated }))
  })

  const fetchTables = useCallback(async () => {
    try {
      return { status: 'ready', tables: await listTables(), error: '' }
    } catch {
      return { status: 'error', tables: [], error: 'No se pudo cargar la lista de mesas.' }
    }
  }, [])

  // Carga inicial (el estado ya arranca en "loading")
  useEffect(() => {
    let active = true
    fetchTables().then((result) => active && setData(result))
    return () => {
      active = false
    }
  }, [fetchTables])

  const retry = () => {
    setData((d) => ({ ...d, status: 'loading', error: '' }))
    fetchTables().then(setData)
  }

  const replaceTable = (updated) =>
    setData((d) => ({
      ...d,
      tables: d.tables.map((t) => (t.tableId === updated.tableId ? updated : t)),
    }))

  const handleCreate = async (values) => {
    const created = await createTable(values)
    setData((d) => ({
      ...d,
      tables: [...d.tables, created].sort((a, b) => a.tableNumber - b.tableNumber),
    }))
    setCreating(false)
    toast.success('Mesa creada')
  }

  const handleEdit = async (changes) => {
    const updated = await updateTable(editing.tableId, changes)
    replaceTable(updated)
    setEditing(null)
    toast.success('Cambios guardados')
  }

  const handleReassign = async (waiter) => {
    try {
      await reassignTable(reassigning.tableId, waiter.userId)
    } catch (err) {
      // Lo que se ve quedo viejo (se pago la mesa u otro ADMIN la movio): se actualiza detras del modal
      if (err?.status === 409 || err?.status === 404) fetchStatuses().then(applyStatuses)
      throw err
    }
    setStatuses((current) => ({
      ...current,
      [reassigning.tableId]: {
        ...current[reassigning.tableId],
        waiterId: waiter.userId,
        waiterName: waiter.name,
      },
    }))
    setReassigning(null)
    toast.success(`Mesa ${reassigning.tableNumber} reasignada a ${waiter.name}`)
  }

  const copyQrPath = async (table) => {
    try {
      await navigator.clipboard.writeText(`/m/${table.qrToken}`)
      setCopiedId(table.tableId)
      setTimeout(() => setCopiedId((id) => (id === table.tableId ? null : id)), 2000)
    } catch {
      toast.error('No se pudo copiar la ruta del QR')
    }
  }

  // Cada mesa con su estado. Una mesa que no aparece en el estado (p. ej. recien creada) no tiene orden: libre.
  // Si el estado no se pudo cargar no se inventa: las mesas quedan sin estado, en una sola seccion.
  const merged = tables.map((t) => {
    const s = statuses?.[t.tableId]
    if (statusesFailed) return { ...t, status: null }
    return {
      ...t,
      status: s?.status ?? 'libre',
      waiterId: s?.waiterId,
      waiterName: s?.waiterName,
      pendingCalls: s?.pendingCalls ?? [],
    }
  })

  const cardProps = (t) => ({
    table: t,
    copied: copiedId === t.tableId,
    onCopy: () => copyQrPath(t),
    onQr: () => setPrintingQr(t),
    onEdit: () => setEditing(t),
    onReassign: () => setReassigning(t),
  })

  const loading = status === 'loading' || (status === 'ready' && statuses === null)

  return (
    <AdminPage
      title="Gestión de Mesas"
      actions={
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => setCreating(true)}
          aria-label="Agregar mesa"
        >
          <Plus size={18} aria-hidden="true" />
          <span className="btn__text">Nueva Mesa</span>
        </button>
      }
    >
      {status === 'ready' && !loading && !statusesFailed && merged.length > 0 && (
        <TableStats tables={merged} totalLabel="Total" />
      )}

      {status === 'error' ? (
        <div className="tables-state" role="alert">
          <TriangleAlert size={28} />
          <p>{error}</p>
          <button type="button" className="btn btn--ghost" onClick={retry}>
            <RefreshCw size={16} /> Reintentar
          </button>
        </div>
      ) : loading ? (
        <div className="ts-grid" aria-busy="true" aria-label="Cargando mesas">
          <SkeletonCards />
        </div>
      ) : tables.length === 0 ? (
        <div className="tables-state">
          <p>Todavía no hay mesas.</p>
        </div>
      ) : statusesFailed ? (
        <section className="ts-section" aria-labelledby="tm-all">
          <h2 id="tm-all" className="ts-section-title">
            Mesas
          </h2>
          <p className="tm-notice" role="status">
            No se pudo cargar el estado de las mesas: se muestran todas, sin dividir.
          </p>
          <div className="ts-grid">
            {merged.map((t) => (
              <AdminTableCard key={t.tableId} {...cardProps(t)} />
            ))}
          </div>
        </section>
      ) : (
        TABLE_SECTIONS.map((section) => {
          const rows = sortForSection(merged, section.status, user?.userId)
          const titleId = `tm-section-${section.status}`
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
                    <AdminTableCard key={t.tableId} {...cardProps(t)} />
                  ))}
                </div>
              )}
            </section>
          )
        })
      )}

      {creating && (
        <TableFormModal mode="create" onSubmit={handleCreate} onClose={() => setCreating(false)} />
      )}
      {printingQr && <QrPrintModal table={printingQr} onClose={() => setPrintingQr(null)} />}

      {editing && (
        <TableFormModal
          mode="edit"
          table={editing}
          onSubmit={handleEdit}
          onClose={() => setEditing(null)}
        />
      )}
      {reassigning && (
        <ReassignTableModal
          tableNumber={reassigning.tableNumber}
          currentWaiterId={statuses?.[reassigning.tableId]?.waiterId}
          currentWaiterName={statuses?.[reassigning.tableId]?.waiterName}
          onConfirm={handleReassign}
          onClose={() => setReassigning(null)}
        />
      )}
    </AdminPage>
  )
}
