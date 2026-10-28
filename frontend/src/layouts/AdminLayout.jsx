import {
  Clock,
  CreditCard,
  DollarSign,
  LayoutDashboard,
  LogOut,
  Pizza,
  Table,
  Tag,
  UtensilsCrossed,
  Users,
  Wallet,
} from 'lucide-react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth.js'
import { initial } from '../utils/user.js'
import './AdminLayout.css'

// Solo "Usuarios" existe por ahora; el resto se activa cuando se construya cada modulo.
// "mobile" marca los 4 destinos de la barra inferior (el diseno permite 4-5).
const NAV = [
  { label: 'Dashboard', icon: LayoutDashboard, mobile: true },
  { label: 'Mesas', icon: Table, mobile: true },
  { label: 'Productos', icon: UtensilsCrossed },
  { label: 'Categorías', icon: Tag },
  { label: 'Usuarios', icon: Users, to: '/admin/usuarios', mobile: true },
  { label: 'Turnos', icon: Clock, mobile: true },
  { label: 'Ventas', icon: DollarSign },
  { label: 'Cierre de Caja', icon: Wallet },
  { label: 'Métodos Pago', icon: CreditCard },
]

function NavItem({ item }) {
  const Icon = item.icon
  const content = (
    <>
      <Icon size={20} aria-hidden="true" />
      <span className="nav-item__label">{item.label}</span>
    </>
  )

  if (!item.to) {
    return (
      <button
        type="button"
        className={`nav-item nav-item--disabled${item.mobile ? ' nav-item--mobile' : ''}`}
        disabled
        title="Próximamente"
      >
        {content}
      </button>
    )
  }

  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        `nav-item${isActive ? ' nav-item--active' : ''}${item.mobile ? ' nav-item--mobile' : ''}`
      }
    >
      {content}
    </NavLink>
  )
}

export function AdminLayout() {
  const { logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Pizza size={28} className="brand__icon" aria-hidden="true" />
          <span className="brand__name">GastroCore</span>
        </div>
        <nav className="sidebar__nav" aria-label="Principal">
          {NAV.map((item) => (
            <NavItem key={item.label} item={item} />
          ))}
        </nav>
        <button type="button" className="nav-item nav-item--logout" onClick={handleLogout}>
          <LogOut size={20} aria-hidden="true" />
          <span className="nav-item__label">
            <span className="hide-sm">Cerrar Sesión</span>
            <span className="show-sm">Salir</span>
          </span>
        </button>
      </aside>
      <main className="shell__main">
        <Outlet />
      </main>
    </div>
  )
}

// Barra superior de cada pantalla: titulo, acciones y avatar del usuario
export function AdminPage({ title, actions, children }) {
  const { user } = useAuth()

  return (
    <>
      <header className="topbar">
        <h1 className="topbar__title">{title}</h1>
        <div className="topbar__actions">
          {actions}
          <span className="avatar avatar--me" title={user?.email}>
            {initial(user?.email)}
          </span>
        </div>
      </header>
      <div className="content">{children}</div>
    </>
  )
}
