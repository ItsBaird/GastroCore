import {
  Bell,
  ClipboardList,
  LogOut,
  Pizza,
  Table,
  User,
} from 'lucide-react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth.js'
import { initial } from '../utils/user.js'
import './WaiterLayout.css'

const NAV = [
  { label: 'Mis Mesas', icon: Table, to: '/mesero/mesas', mobile: true },
  { label: 'Pedidos Activos', icon: ClipboardList, mobile: true },
  { label: 'Llamados', icon: Bell, mobile: true },
  { label: 'Mi Turno', icon: User, mobile: true },
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

export function WaiterLayout() {
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

export function WaiterPage({ title, badge, actions, children }) {
  const { user } = useAuth()

  return (
    <>
      <header className="topbar">
        <div className="topbar__left">
          <h1 className="topbar__title">{title}</h1>
          {badge}
        </div>
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
