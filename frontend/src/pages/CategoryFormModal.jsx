import { LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { Field } from '../components/Field.jsx'
import { Modal } from '../components/Modal.jsx'
import { mapCatalogError } from '../utils/catalog.js'

// Mismas reglas que el backend (zod): el servidor siempre vuelve a validar
function validate({ name, displayOrder }) {
  const errors = {}
  if (!name.trim()) errors.name = 'El nombre es obligatorio'
  else if (name.trim().length > 80) errors.name = 'Admite hasta 80 caracteres'
  if (displayOrder.trim() && !/^\d{1,5}$/.test(displayOrder.trim())) {
    errors.displayOrder = 'Debe ser un número entero de 0 en adelante'
  }
  return errors
}

// mode "create" o "edit". El orden (displayOrder) define la posicion en el menu; vacio = al final.
export function CategoryFormModal({ mode, category, onSubmit, onClose }) {
  const isEdit = mode === 'edit'
  const [values, setValues] = useState({
    name: category?.name ?? '',
    displayOrder: category?.displayOrder == null ? '' : String(category.displayOrder),
  })
  const [errors, setErrors] = useState({})
  const [general, setGeneral] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (key) => (event) => {
    setValues((current) => ({ ...current, [key]: event.target.value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  const nextOrder = values.displayOrder.trim() === '' ? null : Number(values.displayOrder)
  const unchanged =
    isEdit && values.name.trim() === category.name && nextOrder === (category.displayOrder ?? null)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setGeneral('')

    const found = validate(values)
    setErrors(found)
    if (Object.keys(found).length) return

    setBusy(true)
    try {
      // En creacion, sin orden se omite; en edicion null lo borra
      const payload = { name: values.name.trim() }
      if (nextOrder !== null || isEdit) payload.displayOrder = nextOrder
      await onSubmit(payload)
    } catch (err) {
      const mapped = mapCatalogError(err, { conflict: 'Ya existe una categoría con ese nombre' })
      setErrors(mapped.fields ?? {})
      setGeneral(mapped.general ?? '')
      setBusy(false)
    }
  }

  const formId = 'category-form'

  return (
    <Modal
      title={isEdit ? 'Editar categoría' : 'Nueva categoría'}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" form={formId} className="btn btn--primary" disabled={busy || unchanged}>
            {busy && <LoaderCircle className="spin" size={16} />}
            {isEdit ? 'Guardar cambios' : 'Crear categoría'}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} noValidate className="catalog-form">
        {general && (
          <div className="alert" role="alert">
            {general}
          </div>
        )}

        <Field label="Nombre" error={errors.name}>
          {(props) => (
            <input
              {...props}
              className="field__input"
              type="text"
              maxLength={80}
              placeholder="Pizzas"
              value={values.name}
              onChange={set('name')}
              disabled={busy}
            />
          )}
        </Field>

        <Field
          label="Orden en el menú"
          error={errors.displayOrder}
          hint="Opcional. Las categorías con número menor aparecen primero; sin número, al final."
        >
          {(props) => (
            <input
              {...props}
              className="field__input"
              type="text"
              inputMode="numeric"
              placeholder="1"
              value={values.displayOrder}
              onChange={set('displayOrder')}
              disabled={busy}
            />
          )}
        </Field>
      </form>
    </Modal>
  )
}
