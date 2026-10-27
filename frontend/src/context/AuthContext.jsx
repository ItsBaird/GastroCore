import { createContext, useCallback, useContext, useMemo, useState } from 'react'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [accessToken, setAccessToken] = useState(null)
  const [user, setUser] = useState(null)

  const login = useCallback((token, userData) => {
    setAccessToken(token)
    setUser(userData)
  }, [])

  const logout = useCallback(() => {
    setAccessToken(null)
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ accessToken, user, login, logout }),
    [accessToken, user, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
