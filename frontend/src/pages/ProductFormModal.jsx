import { ImagePlus, LoaderCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Field } from '../components/Field.jsx'
import { Modal } from '../components/Modal.jsx'
import { mapCatalogError, validatePhoto } from '../utils/catalog.js'

// Mismas reglas que el backend (zod): el servidor siempre vuelve a validar
function validate(values, { photo, requirePhoto }) {
  const errors = {}
  if (!values.name.trim()) errors.name = 'El nombre es obligatorio'
  else if (values.name.trim().length > 120) errors.name = 'Admite hasta 120 caracteres'
  if (!values.price.trim()) errors.price = 'El precio es obligatorio'
  else if (!/^\d{1,9}$/.test(values.price.trim())) {
    errors.price = 'Debe ser un entero en COP, sin puntos ni decimales'
  }
  if (!values.categoryId) errors.categoryId = 'Selecciona una categoría'
  if (photo) {
    const photoError = validatePhoto(photo)
    if (photoError) errors.photo = photoError
  } else if (requirePhoto) {
    errors.photo = 'La foto es obligatoria'
  }
  return errors
}

// mode "create": la foto es obligatoria. mode "edit": solo se envia lo que cambio
// (si no se elige otra foto, se conserva la actual).
export function ProductFormModal({ mode, product, categories, onSubmit, onClose }) {
  const isEdit = mode === 'edit'
  const [values, setValues] = useState({
    name: product?.name ?? '',
    description: product?.description ?? '',
    price: product ? String(product.price) : '',
    categoryId: product?.categoryId ?? '',
    isAvailable: product?.isAvailable ?? true,
  })
  const [photo, setPhoto] = useState(null)
  const [errors, setErrors] = useState({})
  const [general, setGeneral] = useState('')
  const [busy, setBusy] = useState(false)

  // Vista previa local de la foto elegida; se libera al cambiarla o cerrar
  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo])
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview])

  const set = (key) => (event) => {
    const value = key === 'isAvailable' ? event.target.value === 'true' : event.target.value
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  const pickPhoto = (event) => {
    const file = event.target.files?.[0] ?? null
    setPhoto(file)
    setErrors((current) => ({ ...current, photo: file ? validatePhoto(file) : undefined }))
  }

  const unchanged =
    isEdit &&
    !photo &&
    values.name.trim() === product.name &&
    values.description.trim() === (product.description ?? '') &&
    values.price.trim() === String(product.price) &&
    values.categoryId === product.categoryId &&
    values.isAvailable === product.isAvailable

  const handleSubmit = async (event) => {
    event.preventDefault()
    setGeneral('')

    const found = validate(values, { photo, requirePhoto: !isEdit })
    setErrors(found)
    if (Object.keys(found).length) return

    // Se envian solo los campos que cambiaron al editar; todo al crear
    const form = new FormData()
    const add = (key, value, original) => {
      if (!isEdit || value !== original) form.append(key, value)
    }
    add('name', values.name.trim(), product?.name)
    add('description', values.description.trim(), product?.description ?? '')
    add('price', values.price.trim(), String(product?.price))
    add('categoryId', values.categoryId, product?.categoryId)
    add('isAvailable', String(values.isAvailable), String(product?.isAvailable))
    if (photo) form.append('photo', photo)

    setBusy(true)
    try {
      await onSubmit(form)
    } catch (err) {
      const mapped = mapCatalogError(err, {
        conflict: 'Ya existe un producto con ese nombre en la categoría',
      })
      setErrors(mapped.fields ?? {})
      setGeneral(mapped.general ?? '')
      setBusy(false)
    }
  }

  const formId = 'product-form'
  const shownPhoto = preview ?? (isEdit ? product.photoUrl : null)

  return (
    <Modal
      title={isEdit ? 'Editar producto' : 'Agregar producto'}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" form={formId} className="btn btn--primary" disabled={busy || unchanged}>
            {busy && <LoaderCircle className="spin" size={16} />}
            {isEdit ? 'Guardar cambios' : 'Crear producto'}
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
              maxLength={120}
              placeholder="Pizza Margarita"
              value={values.name}
              onChange={set('name')}
              disabled={busy}
            />
          )}
        </Field>

        <Field label="Descripción" error={errors.description}>
          {(props) => (
            <textarea
              {...props}
              className="field__input field__textarea"
              rows={3}
              placeholder="Tomate, mozzarella, albahaca"
              value={values.description}
              onChange={set('description')}
              disabled={busy}
            />
          )}
        </Field>

        <div className="catalog-form__row">
          <Field label="Precio (COP)" error={errors.price} hint="Entero, impuestos incluidos">
            {(props) => (
              <input
                {...props}
                className="field__input"
                type="text"
                inputMode="numeric"
                placeholder="28000"
                value={values.price}
                onChange={set('price')}
                disabled={busy}
              />
            )}
          </Field>

          <Field label="Categoría" error={errors.categoryId}>
            {(props) => (
              <select
                {...props}
                className="field__select"
                value={values.categoryId}
                onChange={set('categoryId')}
                disabled={busy}
              >
                <option value="" disabled>
                  Selecciona una categoría
                </option>
                {categories.map((c) => (
                  <option key={c.categoryId} value={c.categoryId}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>

        <Field
          label={isEdit ? 'Foto (opcional)' : 'Foto'}
          error={errors.photo}
          hint={
            isEdit
              ? 'Elige otra foto solo si quieres reemplazar la actual. JPG, PNG o WebP, máximo 2 MB.'
              : 'JPG, PNG o WebP, máximo 2 MB.'
          }
        >
          {(props) => (
            <div className="photo-picker">
              <div className="photo-picker__preview">
                {shownPhoto ? (
                  <img src={shownPhoto} alt="Vista previa de la foto" />
                ) : (
                  <ImagePlus size={24} aria-hidden="true" />
                )}
              </div>
              <input
                {...props}
                className="photo-picker__input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={pickPhoto}
                disabled={busy}
              />
            </div>
          )}
        </Field>

        <Field label="Disponibilidad">
          {(props) => (
            <select
              {...props}
              className="field__select"
              value={String(values.isAvailable)}
              onChange={set('isAvailable')}
              disabled={busy}
            >
              <option value="true">Disponible</option>
              <option value="false">Agotado (no aparece en el menú)</option>
            </select>
          )}
        </Field>
      </form>
    </Modal>
  )
}
