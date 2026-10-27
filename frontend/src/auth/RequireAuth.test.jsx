import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AuthContext } from './authContext.js'
import { RequireAuth } from './RequireAuth.jsx'

function LoginProbe() {
  const { state } = useLocation()
  return <p>LOGIN (desde {state?.from ?? 'ninguna'})</p>
}

function renderGuard({ auth, path = '/privada', roles }) {
  const value = { status: 'authenticated', user: null, ...auth }
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthContext.Provider value={value}>
        <Routes>
          <Route path="/login" element={<LoginProbe />} />
          <Route path="/en-construccion" element={<p>EN CONSTRUCCION</p>} />
          <Route path="/admin/usuarios" element={<p>PANTALLA ADMIN</p>} />
          <Route element={<RequireAuth roles={roles} />}>
            <Route path="/privada" element={<p>CONTENIDO PRIVADO</p>} />
          </Route>
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

const as = (role) => ({ status: 'authenticated', user: { userId: 'u', email: 'a@b.co', role } })

describe('RequireAuth', () => {
  it('mientras recupera la sesion muestra un indicador y no el contenido ni el login', () => {
    renderGuard({ auth: { status: 'checking' } })
    expect(screen.getByRole('status', { name: 'Cargando' })).toBeInTheDocument()
    expect(screen.queryByText('CONTENIDO PRIVADO')).not.toBeInTheDocument()
    expect(screen.queryByText(/LOGIN/)).not.toBeInTheDocument()
  })

  it('sin sesion redirige al login recordando la ruta pedida', () => {
    renderGuard({ auth: { status: 'anonymous', user: null } })
    expect(screen.getByText('LOGIN (desde /privada)')).toBeInTheDocument()
    expect(screen.queryByText('CONTENIDO PRIVADO')).not.toBeInTheDocument()
  })

  it.each(['ADMIN', 'WAITER', 'COOK'])('sin restriccion de rol deja pasar a %s', (role) => {
    renderGuard({ auth: as(role) })
    expect(screen.getByText('CONTENIDO PRIVADO')).toBeInTheDocument()
  })

  it('deja pasar al rol permitido', () => {
    renderGuard({ auth: as('ADMIN'), roles: ['ADMIN'] })
    expect(screen.getByText('CONTENIDO PRIVADO')).toBeInTheDocument()
  })

  it('permite varios roles', () => {
    renderGuard({ auth: as('WAITER'), roles: ['WAITER', 'ADMIN'] })
    expect(screen.getByText('CONTENIDO PRIVADO')).toBeInTheDocument()
  })

  it.each(['WAITER', 'COOK'])('%s en una ruta de ADMIN va a su pantalla de inicio', (role) => {
    renderGuard({ auth: as(role), roles: ['ADMIN'] })
    expect(screen.getByText('EN CONSTRUCCION')).toBeInTheDocument()
    expect(screen.queryByText('CONTENIDO PRIVADO')).not.toBeInTheDocument()
  })

  it('un ADMIN en una ruta que no es suya va a la gestion de usuarios', () => {
    renderGuard({ auth: as('ADMIN'), roles: ['WAITER'] })
    expect(screen.getByText('PANTALLA ADMIN')).toBeInTheDocument()
  })
})
