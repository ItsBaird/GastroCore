import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

export default function RequireAuth({ roles, children }) {
  const { user, accessToken } = useAuth()

  if (!accessToken) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user?.role)) return <Navigate to="/login" replace />

  return children
}
