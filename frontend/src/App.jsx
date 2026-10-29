import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './auth/RequireAuth.jsx'
import { homePathFor } from './auth/paths.js'
import { useAuth } from './auth/useAuth.js'
import { AdminLayout } from './layouts/AdminLayout.jsx'
import LoginPage from './pages/LoginPage.jsx'
import { NotFoundPage, UnderConstructionPage } from './pages/StatusPages.jsx'
import TablesPage from './pages/TablesPage.jsx'
import UsersPage from './pages/UsersPage.jsx'

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
          <Route path="mesas" element={<TablesPage />} />
        </Route>
      </Route>

      <Route element={<RequireAuth />}>
        <Route path="/en-construccion" element={<UnderConstructionPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
