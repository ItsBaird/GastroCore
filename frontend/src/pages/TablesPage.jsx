import { Check, Copy, Plus, RefreshCw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { createTable, listTables, reassignTable, updateTable } from '../api/tables.js'
import { listTableStatuses } from '../api/tablesStatus.js'
import { useToast } from '../components/Toast.jsx'
import { useTableStatusSocket } from '../hooks/useTableStatusSocket.js'
import { AdminPage } from '../layouts/AdminLayout.jsx'
import { ReassignTableModal } from './ReassignTableModal.jsx'
import { TableFormModal } from './TableFormModal.jsx'
import './TablesPage.css'

const STATUS_LABEL = { libre: 'Libre', ocupada: 'Ocupada', en_cobro: 'En cobro' }

function SkeletonCards() {
  return Array.from({ length: 6 }, (_, i) => (
    <div key={i} className="table-card table-card--skeleton" aria-hidden="true" />
  ))
}

export default function TablesPage() {
  const toast = useToast()
  const [{ status, tables, error }, setData] = useState({
    status: 'loading',
    tables: [],
    error: '',
  })
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(null)
  const [copiedId, setCopiedId] = useState(null)
  const [statuses, setStatuses] = useState({})
  const [reassigning, setReassigning] = useState(null)

  // El estado es informativo: si falla, las mesas se siguen pudiendo crear y editar
  const fetchStatuses = useCallback(async () => {
    try {
      const list = await listTableStatuses()
      return Object.fromEntries(list.map((s) => [s.tableId, s]))
    } catch {
      return {}
    }
  }, [])

  useEffect(() => {
    let active = true
    fetchStatuses().then((result) => active && setStatuses(result))
    return () => {
      active = false
    }
  }, [fetchStatuses])

  useTableStatusSocket((updated) => {
    setStatuses((current) => ({ ...current, [updated.tableId]: updated }))
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
      if (err?.status === 409 || err?.status === 404) fetchStatuses().then(setStatuses)
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
      <section className="tables-card" aria-label="Lista de mesas">
        {status === 'error' ? (
          <div className="tables-state" role="alert">
            <TriangleAlert size={28} />
            <p>{error}</p>
            <button type="button" className="btn btn--ghost" onClick={retry}>
              <RefreshCw size={16} /> Reintentar
            </button>
          </div>
        ) : status === 'ready' && tables.length === 0 ? (
          <div className="tables-state">
            <p>Todavía no hay mesas.</p>
          </div>
        ) : (
          <div className="tables-grid">
            {status === 'loading' ? (
              <SkeletonCards />
            ) : (
              tables.map((t) => {
                const tableStatus = statuses[t.tableId]
                const isOpen = tableStatus && tableStatus.status !== 'libre'
                return (
                  <div key={t.tableId} className="table-card">
                    <div className="table-card__header">
                      <h3 className="table-card__number">Mesa {t.tableNumber}</h3>
                      {tableStatus && (
                        <span
                          className={`table-card__pill table-card__pill--${tableStatus.status}`}
                        >
                          {STATUS_LABEL[tableStatus.status]}
                        </span>
                      )}
                    </div>
                    {isOpen && (
                      <p className="table-card__waiter">
                        Atiende: {tableStatus.waiterName ?? 'otro mesero'}
                      </p>
                    )}
                    <div className="table-card__qr">
                      <code className="table-card__qr-path">/m/{t.qrToken}</code>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => copyQrPath(t)}
                        aria-label={`Copiar ruta QR de la mesa ${t.tableNumber}`}
                      >
                        {copiedId === t.tableId ? <Check size={16} /> : <Copy size={16} />}
                      </button>
                    </div>
                    <div className="table-card__actions">
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => setEditing(t)}
                        aria-label={`Editar mesa ${t.tableNumber}`}
                      >
                        Editar
                      </button>
                      {isOpen && (
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => setReassigning(t)}
                          aria-label={`Reasignar mesa ${t.tableNumber}`}
                        >
                          Reasignar
                        </button>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}
      </section>

      {creating && (
        <TableFormModal mode="create" onSubmit={handleCreate} onClose={() => setCreating(false)} />
      )}
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
          currentWaiterId={statuses[reassigning.tableId]?.waiterId}
          currentWaiterName={statuses[reassigning.tableId]?.waiterName}
          onConfirm={handleReassign}
          onClose={() => setReassigning(null)}
        />
      )}
    </AdminPage>
  )
}
