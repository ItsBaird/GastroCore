import { LoaderCircle } from 'lucide-react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { homePathFor } from './paths.js'
import { useAuth } from './useAuth.js'

// Guard de ruta: exige sesion y, si se indican, uno de los roles.
// Uso: <Route element={<RequireAuth roles={['ADMIN']} />}> ...rutas... </Route>
// Ocultar botones no es seguridad: el backend vuelve a validar el rol en cada peticion.
export function RequireAuth({ roles }) {
  const { status, user } = useAuth()
  const location = useLocation()

  if (status === 'checking') {
    return (
      <div className="boot" role="status" aria-label="Cargando">
        <LoaderCircle className="spin" size={28} />
      </div>
    )
  }

  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to={homePathFor(user.role)} replace />
  }

  return <Outlet />
}
