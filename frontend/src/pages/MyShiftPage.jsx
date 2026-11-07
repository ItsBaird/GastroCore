import { LogOut, Pizza } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth.js'
import { MyShiftPanel } from '../components/MyShiftPanel.jsx'
import './MyShiftPage.css'

// Mi turno fuera de los paneles de admin y mesero: para el cocinero, que llega desde la cocina.
// Cualquier usuario con sesion puede entrar.
export default function MyShiftPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <main className="my-shift-page">
      <header className="my-shift-page__header">
        <span className="my-shift-page__brand">
          <Pizza size={26} aria-hidden="true" /> GastroCore
        </span>
        <button type="button" className="btn btn--ghost" onClick={handleLogout}>
          <LogOut size={16} aria-hidden="true" /> Cerrar sesión
        </button>
      </header>
      <h1 className="my-shift-page__title">Mi turno</h1>
      <p className="my-shift-page__user">{user.email}</p>
      <MyShiftPanel />
      {user.role === 'COOK' && (
        <Link className="btn btn--primary my-shift-page__back" to="/cocina">
          Ir a cocina
        </Link>
      )}
    </main>
  )
}
