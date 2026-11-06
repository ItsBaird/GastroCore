import { LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Field } from '../components/Field.jsx'
import { Modal } from '../components/Modal.jsx'
import { POSITION_SUGGESTIONS, mapEmployeeError, validateEmployee } from '../utils/employee.js'
import { roleLabel } from '../utils/user.js'

const textOf = (value) => value ?? ''

// mode "create": se elige un usuario de Auth que todavia no tiene perfil (de ahi sale el userId).
// mode "edit": el usuario no cambia; solo se editan los datos laborales.
// `users` son los usuarios sin perfil (create); `owner` es el usuario del empleado (edit).
export function EmployeeFormModal({ mode, employee, owner, users = [], presetUserId, onSubmit, onClose }) {
  const isEdit = mode === 'edit'
  const [values, setValues] = useState({
    userId: presetUserId ?? '',
    fullName: employee?.fullName ?? '',
    documentNumber: employee?.documentNumber ?? '',
    position: employee?.position ?? '',
    phone: textOf(employee?.phone),
    hireDate: employee?.hireDate ?? '',
  })
  const [errors, setErrors] = useState({})
  const [general, setGeneral] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (key) => (event) => {
    setValues((current) => ({ ...current, [key]: event.target.value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  const clean = {
    fullName: values.fullName.trim(),
    documentNumber: values.documentNumber.trim(),
    position: values.position.trim(),
    phone: values.phone.trim(),
    hireDate: values.hireDate,
  }
  // En edicion solo viajan los campos que cambian (PUT parcial)
  const changes = {}
  if (isEdit) {
    for (const key of Object.keys(clean)) {
      if (clean[key] !== textOf(employee[key])) changes[key] = clean[key]
    }
  }
  const unchanged = isEdit && Object.keys(changes).length === 0
  const noUsers = !isEdit && users.length === 0

  const handleSubmit = async (event) => {
    event.preventDefault()
    setGeneral('')

    const found = validateEmployee(values, { needsUser: !isEdit })
    setErrors(found)
    if (Object.keys(found).length) return

    setBusy(true)
    try {
      if (isEdit) {
        await onSubmit(changes)
      } else {
        const payload = { userId: values.userId, ...clean }
        if (!payload.phone) delete payload.phone
        await onSubmit(payload)
      }
    } catch (err) {
      const mapped = mapEmployeeError(err)
      setErrors(mapped.fields ?? {})
      setGeneral(mapped.general ?? '')
      setBusy(false)
    }
  }

  const formId = 'employee-form'

  return (
    <Modal
      title={isEdit ? 'Editar empleado' : 'Nuevo empleado'}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="submit"
            form={formId}
            className="btn btn--primary"
            disabled={busy || unchanged || noUsers}
          >
            {busy && <LoaderCircle className="spin" size={16} />}
            {isEdit ? 'Guardar cambios' : 'Registrar empleado'}
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

        {isEdit ? (
          owner && (
            <p className="employee-owner">
              Cuenta: <strong>{owner.email}</strong> · {roleLabel(owner.role)}
            </p>
          )
        ) : noUsers ? (
          <div className="alert alert--info" role="status">
            Todos los usuarios ya tienen perfil de empleado. Primero crea la cuenta en{' '}
            <Link to="/admin/usuarios">Usuarios</Link>.
          </div>
        ) : (
          <Field
            label="Usuario"
            error={errors.userId}
            hint="Cuenta creada en Usuarios que todavía no tiene perfil laboral."
          >
            {(props) => (
              <select
                {...props}
                className="field__select"
                value={values.userId}
                onChange={set('userId')}
                disabled={busy}
              >
                <option value="">Selecciona un usuario</option>
                {users.map((u) => (
                  <option key={u.userId} value={u.userId}>
                    {u.email} · {roleLabel(u.role)}
                    {u.isActive ? '' : ' (inactivo)'}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}

        <Field label="Nombre completo" error={errors.fullName}>
          {(props) => (
            <input
              {...props}
              className="field__input"
              type="text"
              maxLength={150}
              placeholder="Carlos Rodríguez"
              value={values.fullName}
              onChange={set('fullName')}
              disabled={busy || noUsers}
            />
          )}
        </Field>

        <div className="catalog-form__row">
          <Field label="Documento" error={errors.documentNumber}>
            {(props) => (
              <input
                {...props}
                className="field__input"
                type="text"
                maxLength={30}
                placeholder="1012345678"
                value={values.documentNumber}
                onChange={set('documentNumber')}
                disabled={busy || noUsers}
              />
            )}
          </Field>
          <Field label="Teléfono" error={errors.phone}>
            {(props) => (
              <input
                {...props}
                className="field__input"
                type="tel"
                maxLength={30}
                placeholder="3001234567"
                value={values.phone}
                onChange={set('phone')}
                disabled={busy || noUsers}
              />
            )}
          </Field>
        </div>

        <div className="catalog-form__row">
          <Field label="Cargo" error={errors.position}>
            {(props) => (
              <>
                <input
                  {...props}
                  className="field__input"
                  type="text"
                  list="employee-positions"
                  maxLength={50}
                  placeholder="Mesero"
                  value={values.position}
                  onChange={set('position')}
                  disabled={busy || noUsers}
                />
                <datalist id="employee-positions">
                  {POSITION_SUGGESTIONS.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field label="Fecha de ingreso" error={errors.hireDate}>
            {(props) => (
              <input
                {...props}
                className="field__input"
                type="date"
                value={values.hireDate}
                onChange={set('hireDate')}
                disabled={busy || noUsers}
              />
            )}
          </Field>
        </div>
      </form>
    </Modal>
  )
}
