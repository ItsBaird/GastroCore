import {
  Clock,
  ConciergeBell,
  CreditCard,
  DollarSign,
  IdCard,
  LayoutDashboard,
  LogOut,
  Menu,
  Pizza,
  Table,
  Tag,
  UtensilsCrossed,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth.js'
import { initial } from '../utils/user.js'
import './AdminLayout.css'

// Movil (<= 640px): la barra inferior no alcanzaba para todas las pantallas del ADMIN. Ahora el menu completo es un
// panel lateral que se abre con el boton de hamburguesa de la barra superior (AdminPage). Escritorio y tablet no
// cambian. Las clases van bajo .shell--admin: el mesero comparte .shell/.sidebar y conserva su barra inferior.
const MOBILE_QUERY = '(width <= 640px)'
const AdminMenuContext = createContext(null)

function useIsMobile() {
  const [mobile, setMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(MOBILE_QUERY).matches : false,
  )
  useEffect(() => {
    if (!window.matchMedia) return undefined
    const query = window.matchMedia(MOBILE_QUERY)
    const update = () => setMobile(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return mobile
}

// Todos los destinos del ADMIN. En movil se ven todos en el panel lateral ("mobile" ya no recorta la lista).
const NAV = [
  // GC-RPT-0004. Fuera de la barra movil para dejar el lugar a Vista Mesero
  { label: 'Dashboard', icon: LayoutDashboard, to: '/admin/dashboard' },
  { label: 'Mesas', icon: Table, to: '/admin/mesas', mobile: true },
  // El ADMIN tambien atiende mesas (WAITER y ADMIN comparten /mesero): acceso directo al panel del mesero
  { label: 'Vista Mesero', short: 'Mesero', icon: ConciergeBell, to: '/mesero/mesas', mobile: true },
  { label: 'Productos', icon: UtensilsCrossed, to: '/admin/productos' },
  { label: 'Categorías', icon: Tag, to: '/admin/categorias' },
  { label: 'Usuarios', icon: Users, to: '/admin/usuarios', mobile: true },
  { label: 'Empleados', icon: IdCard, to: '/admin/empleados' },
  { label: 'Turnos', icon: Clock, to: '/admin/turnos', mobile: true },
  { label: 'Ventas', icon: DollarSign, to: '/admin/ventas' },
  { label: 'Cierre de Caja', icon: Wallet, to: '/admin/cierre-caja' },
  { label: 'Métodos Pago', icon: CreditCard, to: '/admin/metodos-pago' },
]

function NavItem({ item, onNavigate }) {
  const Icon = item.icon
  // En el panel lateral de movil cabe la etiqueta completa: ya no hace falta la corta de la barra inferior
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
      onClick={onNavigate}
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
  const mobile = useIsMobile()
  const [menuOpen, setMenuOpen] = useState(false)
  const drawerRef = useRef(null)
  const triggerRef = useRef(null)

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  const openMenu = useCallback((trigger) => {
    triggerRef.current = trigger ?? null
    setMenuOpen(true)
  }, [])

  const closeMenu = useCallback(() => setMenuOpen(false), [])

  // En escritorio/tablet el panel no existe como tal: solo cuenta abierto en movil
  const drawerOpen = mobile && menuOpen

  // Abierto: foco adentro, Escape cierra, la pagina de fondo no se desplaza. Al cerrar, el foco vuelve al boton.
  useEffect(() => {
    if (!drawerOpen) return undefined
    const drawer = drawerRef.current
    drawer?.querySelector('.drawer-close')?.focus()
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'

    const onKey = (event) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        return
      }
      if (event.key !== 'Tab' || !drawer) return
      // Foco atrapado dentro del panel mientras esta abierto (dialogo modal)
      const focusable = [...drawer.querySelectorAll('a[href], button:not([disabled])')]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    const trigger = triggerRef.current
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      // Si se eligio otra pantalla, el boton que abrio el panel ya no existe: el foco va al de la pantalla nueva
      const target = trigger?.isConnected ? trigger : document.querySelector('.menu-btn')
      target?.focus?.()
    }
  }, [drawerOpen])

  return (
    <AdminMenuContext.Provider value={{ mobile, menuOpen: drawerOpen, openMenu }}>
      <div className={`shell shell--admin${drawerOpen ? ' shell--menu-open' : ''}`}>
        {/* Fondo oscuro detras del panel: tocarlo cierra */}
        {mobile && (
          <div className="drawer-backdrop" aria-hidden="true" onClick={closeMenu} />
        )}
        <aside
          ref={drawerRef}
          id="admin-menu"
          className="sidebar"
          // En movil es un dialogo modal; cerrado queda fuera del alcance del teclado y del lector (inert)
          {...(mobile
            ? {
                role: 'dialog',
                'aria-modal': drawerOpen ? 'true' : undefined,
                'aria-label': 'Menú',
                inert: !drawerOpen,
              }
            : {})}
        >
          <div className="brand">
            <Pizza size={28} className="brand__icon" aria-hidden="true" />
            <span className="brand__name">GastroCore</span>
            {mobile && (
              <button type="button" className="drawer-close" onClick={closeMenu} aria-label="Cerrar menú">
                <X size={22} aria-hidden="true" />
              </button>
            )}
          </div>
          <nav className="sidebar__nav" aria-label="Principal">
            {/* Elegir una pantalla cierra el panel */}
            {NAV.map((item) => (
              <NavItem key={item.label} item={item} onNavigate={closeMenu} />
            ))}
          </nav>
          <button type="button" className="nav-item nav-item--logout" onClick={handleLogout}>
            <LogOut size={20} aria-hidden="true" />
            <span className="nav-item__label">Cerrar Sesión</span>
          </button>
        </aside>
        <main className="shell__main">
          <Outlet />
        </main>
      </div>
    </AdminMenuContext.Provider>
  )
}

// Boton de hamburguesa de la barra superior: solo en movil y dentro del AdminLayout
function MenuButton() {
  const menu = useContext(AdminMenuContext)
  if (!menu?.mobile) return null
  return (
    <button
      type="button"
      className="menu-btn"
      aria-label="Abrir menú"
      aria-expanded={menu.menuOpen}
      aria-controls="admin-menu"
      onClick={(event) => menu.openMenu(event.currentTarget)}
    >
      <Menu size={22} aria-hidden="true" />
    </button>
  )
}

// Barra superior de cada pantalla: titulo, acciones y avatar del usuario
export function AdminPage({ title, actions, children }) {
  const { user } = useAuth()

  return (
    <>
      <header className="topbar">
        <div className="topbar__lead">
          <MenuButton />
          <h1 className="topbar__title">{title}</h1>
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
