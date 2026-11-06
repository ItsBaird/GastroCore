import { LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { Field } from '../components/Field.jsx'
import { Modal } from '../components/Modal.jsx'
import { mapPaymentMethodError, validatePaymentMethod } from '../utils/paymentMethod.js'

// mode "create": nombre, si es efectivo y si nace activo. mode "edit": los mismos datos del metodo.
export function PaymentMethodFormModal({ mode, method, onSubmit, onClose }) {
  const isEdit = mode === 'edit'
  const [values, setValues] = useState({
    name: method?.name ?? '',
    isCash: method?.isCash ?? false,
    isActive: method?.isActive ?? true,
  })
  const [errors, setErrors] = useState({})
  const [general, setGeneral] = useState('')
  const [busy, setBusy] = useState(false)

  const setText = (key) => (event) => {
    setValues((current) => ({ ...current, [key]: event.target.value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }
  const setFlag = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.checked }))

  const name = values.name.trim()
  const unchanged =
    isEdit && name === method.name && values.isCash === method.isCash && values.isActive === method.isActive

  const handleSubmit = async (event) => {
    event.preventDefault()
    setGeneral('')

    const found = validatePaymentMethod(values)
    setErrors(found)
    if (Object.keys(found).length) return

    setBusy(true)
    try {
      if (isEdit) {
        // El nombre va siempre (el servidor lo exige); las banderas, solo si cambiaron
        const changes = { name }
        if (values.isCash !== method.isCash) changes.isCash = values.isCash
        if (values.isActive !== method.isActive) changes.isActive = values.isActive
        await onSubmit(changes)
      } else {
        await onSubmit({ name, isCash: values.isCash, isActive: values.isActive })
      }
    } catch (err) {
      const mapped = mapPaymentMethodError(err)
      setErrors(mapped.fields ?? {})
      setGeneral(mapped.general ?? '')
      setBusy(false)
    }
  }

  const formId = 'payment-method-form'

  return (
    <Modal
      title={isEdit ? 'Editar método de pago' : 'Nuevo método de pago'}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" form={formId} className="btn btn--primary" disabled={busy || unchanged}>
            {busy && <LoaderCircle className="spin" size={16} />}
            {isEdit ? 'Guardar cambios' : 'Crear método'}
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
              maxLength={50}
              placeholder="Tarjeta débito"
              value={values.name}
              onChange={setText('name')}
              disabled={busy}
            />
          )}
        </Field>

        <label className="pm-check">
          <input type="checkbox" checked={values.isCash} onChange={setFlag('isCash')} disabled={busy} />
          <span>
            <span className="pm-check__title">Es efectivo</span>
            <span className="pm-check__hint">Se recibe dinero en caja y se calcula el cambio.</span>
          </span>
        </label>

        <label className="pm-check">
          <input type="checkbox" checked={values.isActive} onChange={setFlag('isActive')} disabled={busy} />
          <span>
            <span className="pm-check__title">Activo</span>
            <span className="pm-check__hint">Solo los métodos activos se ofrecen al cobrar.</span>
          </span>
        </label>
      </form>
    </Modal>
  )
}
