import { Navigate, Route, Routes } from 'react-router-dom'
import AdminLayout from './layouts/AdminLayout.jsx'
import LoginPage from './pages/LoginPage.jsx'
import TablesPage from './pages/TablesPage.jsx'
import RequireAuth from './components/RequireAuth.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/admin"
        element={
          <RequireAuth roles={['ADMIN']}>
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="tables" replace />} />
        <Route path="tables" element={<TablesPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/admin/tables" replace />} />
    </Routes>
  )
}
