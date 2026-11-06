import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './auth/RequireAuth.jsx'
import { homePathFor } from './auth/paths.js'
import { useAuth } from './auth/useAuth.js'
import { AdminLayout } from './layouts/AdminLayout.jsx'
import { WaiterLayout } from './layouts/WaiterLayout.jsx'
import CategoriesPage from './pages/CategoriesPage.jsx'
import EmployeesPage from './pages/EmployeesPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import ProductsPage from './pages/ProductsPage.jsx'
import ShiftsPage from './pages/ShiftsPage.jsx'
import { NotFoundPage, UnderConstructionPage } from './pages/StatusPages.jsx'
import TablesPage from './pages/TablesPage.jsx'
import UsersPage from './pages/UsersPage.jsx'
import OrderDetailPage from './pages/OrderDetailPage.jsx'
import OrderTakingPage from './pages/OrderTakingPage.jsx'
import WaiterTablesPanelPage from './pages/WaiterTablesPanelPage.jsx'

function Home() {
  const { status, user } = useAuth()
  if (status === 'authenticated') return <Navigate to={homePathFor(user.role)} replace />
  return <Navigate to="/login" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<LoginPage />} />

      {/* Solo ADMIN. Las demas pantallas del panel se agregan aqui cuando existan */}
      <Route element={<RequireAuth roles={['ADMIN']} />}>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="usuarios" replace />} />
          <Route path="usuarios" element={<UsersPage />} />
          <Route path="empleados" element={<EmployeesPage />} />
          <Route path="turnos" element={<ShiftsPage />} />
          <Route path="mesas" element={<TablesPage />} />
          <Route path="productos" element={<ProductsPage />} />
          <Route path="categorias" element={<CategoriesPage />} />
        </Route>
      </Route>

      <Route element={<RequireAuth roles={['WAITER', 'ADMIN']} />}>
        <Route path="/mesero" element={<WaiterLayout />}>
          <Route index element={<Navigate to="mesas" replace />} />
          <Route path="mesas" element={<WaiterTablesPanelPage />} />
          <Route path="mesas/:orderId" element={<OrderDetailPage />} />
          <Route path="mesas/:orderId/nueva-ronda" element={<OrderTakingPage />} />
        </Route>
      </Route>

      <Route element={<RequireAuth />}>
        <Route path="/en-construccion" element={<UnderConstructionPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
