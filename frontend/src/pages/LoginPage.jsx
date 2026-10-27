import { CircleAlert, Eye, EyeOff, LoaderCircle, Lock, Mail, Pizza } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { homePathFor } from '../auth/paths.js'
import { useAuth } from '../auth/useAuth.js'
import { Field } from '../components/Field.jsx'
import { loginErrorMessage } from '../utils/user.js'
import './LoginPage.css'

export default function LoginPage() {
  const { status, user, expired, login } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  // Con sesion iniciada se va a la ruta que se intentaba abrir (o al inicio del rol);
  // RequireAuth la reenvia al inicio si el rol no tiene acceso
  if (status === 'authenticated') {
    return <Navigate to={location.state?.from ?? homePathFor(user.role)} replace />
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setMessage('')

    const found = {}
    if (!email.trim()) found.email = 'Ingresa tu correo electrónico'
    if (!password) found.password = 'Ingresa tu contraseña'
    setErrors(found)
    if (Object.keys(found).length) return

    setBusy(true)
    try {
      await login(email.trim(), password)
    } catch (err) {
      setMessage(loginErrorMessage(err))
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <section className="login__hero" aria-hidden="true">
        <Pizza size={72} strokeWidth={1.6} />
        <p className="login__brand">GastroCore</p>
        <p className="login__place">La Pizzeta · Neiva</p>
        <p className="login__tagline">
          <span className="hide-sm">Sistema integral de gestión para tu restaurante</span>
          <span className="show-sm">Gestión integral para tu restaurante</span>
        </p>
      </section>

      <section className="login__panel">
        <form className="login__form" onSubmit={handleSubmit} noValidate>
          <h1>Iniciar Sesión</h1>
          <p className="login__subtitle">
            <span className="hide-sm">Ingresa tus credenciales para acceder al sistema</span>
            <span className="show-sm">Ingresa tus credenciales para acceder</span>
          </p>

          {expired && !message && (
            <div className="alert" role="alert">
              <CircleAlert size={18} />
              Tu sesión expiró. Inicia sesión de nuevo.
            </div>
          )}
          {message && (
            <div className="alert" role="alert">
              <CircleAlert size={18} />
              {message}
            </div>
          )}

          <Field label="Correo electrónico" error={errors.email}>
            {(props) => (
              <div className="field__control">
                <Mail className="field__icon" size={20} aria-hidden="true" />
                <input
                  {...props}
                  className="field__input field__input--icon login__input"
                  type="email"
                  autoComplete="username"
                  placeholder="correo@ejemplo.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                />
              </div>
            )}
          </Field>

          <Field label="Contraseña" error={errors.password}>
            {(props) => (
              <div className="field__control">
                <Lock className="field__icon" size={20} aria-hidden="true" />
                <input
                  {...props}
                  className="field__input field__input--icon login__input"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                />
                <button
                  type="button"
                  className="field__toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            )}
          </Field>

          <button type="submit" className="btn btn--primary login__submit" disabled={busy}>
            {busy && <LoaderCircle className="spin" size={18} />}
            Iniciar Sesión
          </button>
          <p className="login__note">
            <span className="hide-sm">Solo personal autorizado del restaurante</span>
            <span className="show-sm">Solo personal autorizado</span>
          </p>
        </form>

        <ul className="login__legend" aria-label="Roles del sistema">
          <li>
            <i style={{ background: 'var(--red-600)' }} />
            <span className="hide-sm">Administrador</span>
            <span className="show-sm">Admin</span>
          </li>
          <li>
            <i style={{ background: 'var(--orange-500)' }} />
            Mesero
          </li>
          <li>
            <i style={{ background: 'var(--yellow-400)' }} />
            <span className="hide-sm">Cocinero</span>
            <span className="show-sm">Cocina</span>
          </li>
        </ul>
      </section>
    </div>
  )
}
