import { useState } from 'react'
import './TableModal.css'

export default function TableModal({ mode, table, onSave, onClose }) {
  const [tableNumber, setTableNumber] = useState(
    mode === 'edit' ? String(table.tableNumber) : '',
  )
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    const num = Number(tableNumber)
    if (!Number.isInteger(num) || num < 1) {
      setError('El numero de mesa debe ser un entero positivo')
      return
    }

    setLoading(true)
    try {
      await onSave({ tableNumber: num })
    } catch (err) {
      if (err.code === 'CONFLICT') {
        setError('El numero de mesa ya existe')
      } else if (err.code === 'VALIDATION_ERROR') {
        setError('Datos invalidos')
      } else {
        setError(err.message || 'Error al guardar')
      }
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{mode === 'create' ? 'Nueva Mesa' : 'Editar Mesa'}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar">
            &times;
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          {error && <p className="modal-error">{error}</p>}
          <label className="modal-label">
            Numero de mesa
            <input
              type="number"
              min="1"
              step="1"
              value={tableNumber}
              onChange={(e) => setTableNumber(e.target.value)}
              required
              autoFocus
              className="modal-input"
            />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn-cancel" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading
                ? 'Guardando...'
                : mode === 'create'
                  ? 'Crear Mesa'
                  : 'Guardar Cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
