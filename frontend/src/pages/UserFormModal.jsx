import { Eye, EyeOff, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { ApiError } from '../api/errors.js'
import { Field } from '../components/Field.jsx'
import { Modal } from '../components/Modal.jsx'
import { ROLE_OPTIONS } from '../utils/user.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Mismas reglas que el backend (zod): el servidor siempre vuelve a validar
function validateCreate({ email, password, role }) {
  const errors = {}
  if (!email.trim()) errors.email = 'El email es obligatorio'
  else if (!EMAIL_RE.test(email.trim())) errors.email = 'Escribe un email válido'
  if (!password) errors.password = 'La contraseña es obligatoria'
  else if (password.length < 10) errors.password = 'Debe tener al menos 10 caracteres'
  else if (password.length > 128) errors.password = 'Admite hasta 128 caracteres'
  if (!role) errors.role = 'Selecciona un rol'
  return errors
}

// Traduce el error de la API a mensajes por campo
function mapApiError(err) {
  if (!(err instanceof ApiError)) return { general: 'No se pudo completar la acción.' }
  if (err.code === 'EMAIL_ALREADY_EXISTS') return { fields: { email: 'Este email ya está registrado' } }
  if (err.code === 'VALIDATION_ERROR' && err.details?.fields) {
    const fields = {}
    err.details.fields.forEach((f) => {
      if (f.path) fields[f.path] = f.message
    })
    return Object.keys(fields).length ? { fields } : { general: err.message }
  }
  if (err.code === 'FORBIDDEN') return { general: err.message }
  if (err.code === 'NETWORK_ERROR') return { general: 'No se pudo conectar con el servidor.' }
  return { general: 'No se pudo completar la acción. Inténtalo de nuevo.' }
}

// mode "create": email, contraseña temporal y rol. mode "edit": solo rol y estado
// (el email y la contraseña no se editan aquí, REQ-F01-07).
export function UserFormModal({ mode, user, isSelf = false, onSubmit, onClose }) {
  const isEdit = mode === 'edit'
  const [values, setValues] = useState({
    email: user?.email ?? '',
    password: '',
    role: user?.role ?? '',
    isActive: user?.isActive ?? true,
  })
  const [errors, setErrors] = useState({})
  const [general, setGeneral] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)

  const set = (key) => (event) => {
    const value = key === 'isActive' ? event.target.value === 'true' : event.target.value
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  const unchanged = isEdit && values.role === user.role && values.isActive === user.isActive

  const handleSubmit = async (event) => {
    event.preventDefault()
    setGeneral('')

    if (!isEdit) {
      const found = validateCreate(values)
      setErrors(found)
      if (Object.keys(found).length) return
    }

    setBusy(true)
    try {
      await onSubmit(
        isEdit
          ? { role: values.role, isActive: values.isActive }
          : { email: values.email.trim(), password: values.password, role: values.role },
      )
    } catch (err) {
      const mapped = mapApiError(err)
      setErrors(mapped.fields ?? {})
      setGeneral(mapped.general ?? '')
      setBusy(false)
    }
  }

  const formId = 'user-form'

  return (
    <Modal
      title={isEdit ? 'Editar usuario' : 'Agregar usuario'}
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
            disabled={busy || unchanged || (isEdit && isSelf)}
          >
            {busy && <LoaderCircle className="spin" size={16} />}
            {isEdit ? 'Guardar cambios' : 'Crear usuario'}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} noValidate className="user-form">
        {general && (
          <div className="alert" role="alert">
            {general}
          </div>
        )}

        <Field label="Email" error={errors.email}>
          {(props) => (
            <input
              {...props}
              className="field__input"
              type="email"
              autoComplete="off"
              placeholder="correo@lapizzeta.com"
              value={values.email}
              onChange={set('email')}
              disabled={isEdit || busy}
            />
          )}
        </Field>

        {!isEdit && (
          <Field
            label="Contraseña temporal"
            error={errors.password}
            hint="Mínimo 10 caracteres. El empleado podrá usarla para su primer ingreso."
          >
            {(props) => (
              <div className="field__control">
                <input
                  {...props}
                  className="field__input"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={values.password}
                  onChange={set('password')}
                  disabled={busy}
                />
                <button
                  type="button"
                  className="field__toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            )}
          </Field>
        )}

        <Field
          label="Rol"
          error={errors.role}
          hint={isEdit && isSelf ? 'No puedes cambiar tu propio rol.' : undefined}
        >
          {(props) => (
            <select
              {...props}
              className="field__select"
              value={values.role}
              onChange={set('role')}
              disabled={busy || (isEdit && isSelf)}
            >
              {!isEdit && (
                <option value="" disabled>
                  Selecciona un rol
                </option>
              )}
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          )}
        </Field>

        {isEdit && (
          <Field
            label="Estado"
            hint={
              isSelf
                ? 'No puedes desactivar tu propia cuenta.'
                : 'Un usuario inactivo no puede iniciar sesión y se cierran sus sesiones.'
            }
          >
            {(props) => (
              <select
                {...props}
                className="field__select"
                value={String(values.isActive)}
                onChange={set('isActive')}
                disabled={busy || isSelf}
              >
                <option value="true">Activo</option>
                <option value="false">Inactivo</option>
              </select>
            )}
          </Field>
        )}
      </form>
    </Modal>
  )
}
