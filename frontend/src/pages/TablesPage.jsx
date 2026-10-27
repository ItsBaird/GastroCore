import { useCallback, useEffect, useState } from 'react'
import { createTable, listTables, updateTable } from '../api/tables.js'
import TableModal from '../components/TableModal.jsx'
import './TablesPage.css'

export default function TablesPage() {
  const [tables, setTables] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modal, setModal] = useState(null)
  const [copied, setCopied] = useState(null)

  const fetchTables = useCallback(async () => {
    try {
      setError('')
      const data = await listTables()
      setTables(data)
    } catch (err) {
      setError(err.message || 'Error al cargar las mesas')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTables()
  }, [fetchTables])

  function openCreate() {
    setModal({ mode: 'create' })
  }

  function openEdit(table) {
    setModal({ mode: 'edit', table })
  }

  async function handleSave(data) {
    if (modal.mode === 'create') {
      await createTable(data)
    } else {
      await updateTable(modal.table.tableId, data)
    }
    setModal(null)
    await fetchTables()
  }

  async function copyToken(token) {
    try {
      await navigator.clipboard.writeText(`/m/${token}`)
      setCopied(token)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      /* clipboard not available */
    }
  }

  if (loading) {
    return <div className="tables-loading">Cargando mesas...</div>
  }

  return (
    <div className="tables-page">
      <div className="tables-header">
        <div>
          <h2>Mesas del restaurante</h2>
          <p className="tables-subtitle">{tables.length} mesas registradas</p>
        </div>
        <button className="btn-primary" onClick={openCreate}>
          + Nueva Mesa
        </button>
      </div>

      {error && <p className="tables-error">{error}</p>}

      {tables.length === 0 && !error ? (
        <div className="tables-empty">
          <p>No hay mesas registradas</p>
          <p>Crea la primera mesa para comenzar.</p>
        </div>
      ) : (
        <div className="tables-card">
          <table className="tables-table">
            <thead>
              <tr>
                <th>Numero</th>
                <th>Ruta QR</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => (
                <tr key={t.tableId}>
                  <td>
                    <span className="table-number">Mesa {t.tableNumber}</span>
                  </td>
                  <td>
                    <div className="qr-cell">
                      <code className="qr-path">/m/{t.qrToken}</code>
                      <button
                        className="btn-copy"
                        onClick={() => copyToken(t.qrToken)}
                        title="Copiar ruta QR"
                      >
                        {copied === t.qrToken ? 'Copiado' : 'Copiar'}
                      </button>
                    </div>
                  </td>
                  <td>
                    <button className="btn-edit" onClick={() => openEdit(t)}>
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <TableModal
          mode={modal.mode}
          table={modal.table}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
