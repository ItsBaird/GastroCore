import { Check, Copy, Plus, RefreshCw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { createTable, listTables, updateTable } from '../api/tables.js'
import { useToast } from '../components/Toast.jsx'
import { AdminPage } from '../layouts/AdminLayout.jsx'
import { TableFormModal } from './TableFormModal.jsx'
import './TablesPage.css'

function SkeletonCards() {
  return Array.from({ length: 6 }, (_, i) => (
    <div key={i} className="table-card table-card--skeleton" aria-hidden="true" />
  ))
}

export default function TablesPage() {
  const toast = useToast()
  const [{ status, tables, error }, setData] = useState({ status: 'loading', tables: [], error: '' })
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(null)
  const [copiedId, setCopiedId] = useState(null)

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
    setData((d) => ({ ...d, tables: d.tables.map((t) => (t.tableId === updated.tableId ? updated : t)) }))

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
              tables.map((t) => (
                <div key={t.tableId} className="table-card">
                  <h3 className="table-card__number">Mesa {t.tableNumber}</h3>
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
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => setEditing(t)}
                    aria-label={`Editar mesa ${t.tableNumber}`}
                  >
                    Editar
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </section>

      {creating && (
        <TableFormModal mode="create" onSubmit={handleCreate} onClose={() => setCreating(false)} />
      )}
      {editing && (
        <TableFormModal mode="edit" table={editing} onSubmit={handleEdit} onClose={() => setEditing(null)} />
      )}
    </AdminPage>
  )
}
