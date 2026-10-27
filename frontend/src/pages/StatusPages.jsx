import { Construction, SearchX } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { homePathFor } from '../auth/paths.js'
import { useAuth } from '../auth/useAuth.js'
import './StatusPages.css'

export function NotFoundPage() {
  const { status, user } = useAuth()
  const target = status === 'authenticated' ? homePathFor(user.role) : '/login'

  return (
    <main className="status-page">
      <SearchX size={40} />
      <h1>Página no encontrada</h1>
      <p>La dirección que buscas no existe.</p>
      <Link className="btn btn--primary" to={target}>
        Volver al inicio
      </Link>
    </main>
  )
}

// Destino de los roles que todavia no tienen pantallas (mesero y cocinero)
export function UnderConstructionPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <main className="status-page">
      <Construction size={40} />
      <h1>Pantalla en construcción</h1>
      <p>Hola, {user.email}. Las pantallas de tu rol estarán disponibles pronto.</p>
      <button type="button" className="btn btn--ghost" onClick={handleLogout}>
        Cerrar sesión
      </button>
    </main>
  )
}
