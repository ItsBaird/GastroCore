import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { loginRequest, logoutRequest } from '../api/auth.js'
import { AuthContext } from './authContext.js'
import { clearSession, getSnapshot, restoreSession, setSession, subscribe } from './session.js'

export function AuthProvider({ children }) {
  const session = useSyncExternalStore(subscribe, getSnapshot)

  // Recupera la sesion con la cookie al abrir o recargar. restoreSession comparte una sola
  // promesa, asi que el doble efecto de StrictMode no dispara dos renovaciones.
  useEffect(() => {
    restoreSession()
  }, [])

  const login = useCallback(async (email, password) => {
    setSession(await loginRequest(email, password))
  }, [])

  const logout = useCallback(async () => {
    try {
      await logoutRequest() // revoca el refresh token en el servidor
    } catch {
      // Aunque falle la red, la sesion local se cierra igual
    } finally {
      clearSession()
    }
  }, [])

  const value = useMemo(
    () => ({
      status: session.status,
      user: session.user,
      expired: session.reason === 'expired',
      login,
      logout,
    }),
    [session, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
