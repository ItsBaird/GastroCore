import {
  Bell,
  ClipboardList,
  LogOut,
  Pizza,
  ShieldCheck,
  Table,
  User,
} from 'lucide-react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { homePathFor } from '../auth/paths.js'
import { useAuth } from '../auth/useAuth.js'
import { useActiveShift } from '../hooks/useActiveShift.js'
import { initial } from '../utils/user.js'
import './WaiterLayout.css'

const NAV = [
  { label: 'Mis Mesas', icon: Table, to: '/mesero/mesas', mobile: true },
  { label: 'Pedidos Activos', icon: ClipboardList, mobile: true },
  { label: 'Llamados', icon: Bell, mobile: true, badge: true },
  { label: 'Mi Turno', icon: User, to: '/mesero/turno', mobile: true },
]

function NavItem({ item }) {
  const Icon = item.icon
  const content = (
    <>
      <Icon size={20} aria-hidden="true" />
      <span className="nav-item__label">
        {item.short ? (
          <>
            <span className="hide-sm">{item.label}</span>
            <span className="show-sm">{item.short}</span>
          </>
        ) : (
          item.label
        )}
      </span>
      {item.badge && <span className="nav-badge" aria-label="llamados pendientes">0</span>}
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

// El ADMIN entra a la vista del mesero desde su menu; este item lo devuelve a su panel
const ADMIN_BACK = {
  label: 'Panel Admin',
  short: 'Admin',
  icon: ShieldCheck,
  to: homePathFor('ADMIN'),
  mobile: true,
}

export function WaiterLayout() {
  const { user, logout } = useAuth()
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
        {/* El ADMIN tambien usa esta vista: la insignia muestra su rol real */}
        <div className={`role-badge${user?.role === 'ADMIN' ? ' role-badge--admin' : ''}`}>
          <span className="role-badge__text">{user?.role === 'ADMIN' ? 'ADMIN' : 'MESERO'}</span>
        </div>
        <nav className="sidebar__nav" aria-label="Principal">
          {NAV.map((item) => (
            <NavItem
              key={item.label}
              // En movil el ADMIN no ve los destinos que aun no existen: deja sitio a "Admin" sin apretar la barra
              item={user?.role === 'ADMIN' && !item.to ? { ...item, mobile: false } : item}
            />
          ))}
          {user?.role === 'ADMIN' && <NavItem item={ADMIN_BACK} />}
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

export function WaiterPage({ title, actions, children, showShiftBadge = true }) {
  const { user } = useAuth()
  const shiftActive = useActiveShift(user?.userId, showShiftBadge)

  return (
    <>
      <header className="topbar">
        <div className="topbar__left">
          <h1 className="topbar__title">{title}</h1>
          {showShiftBadge && shiftActive === true && (
            <span className="turno-badge">
              <span className="turno-badge__dot" />
              Turno Activo
            </span>
          )}
          {showShiftBadge && shiftActive === false && (
            <span className="turno-badge turno-badge--off">
              <span className="turno-badge__dot" />
              Sin Turno
            </span>
          )}
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
