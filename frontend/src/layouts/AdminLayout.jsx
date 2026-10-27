import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useEffect } from 'react'
import { setTokenGetter } from '../api/client.js'
import './AdminLayout.css'

const NAV_ITEMS = [
  { to: '/admin/tables', label: 'Mesas', icon: 'table' },
]

export default function AdminLayout() {
  const { user, accessToken, logout } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    setTokenGetter(() => accessToken)
  }, [accessToken])

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <div className="admin-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="var(--color-brand)">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.22.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
          </svg>
          <span className="sidebar-title">GastroCore</span>
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `nav-item${isActive ? ' nav-item--active' : ''}`
              }
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z" />
              </svg>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button className="nav-item sidebar-logout" onClick={handleLogout}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
          </svg>
          Cerrar Sesion
        </button>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <h1 className="topbar-title">Gestion de Mesas</h1>
          <div className="topbar-user">
            <span>{user?.email || 'Admin'}</span>
            <div className="avatar">{(user?.email?.[0] || 'A').toUpperCase()}</div>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
