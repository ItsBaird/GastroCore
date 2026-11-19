import { readBody, toApiError } from '../api/errors.js'

// Sesion en memoria: el access token NUNCA se guarda en localStorage (SAD, R1).
// El refresh token vive en una cookie httpOnly que el JavaScript no puede leer.
const store = { accessToken: null, user: null, status: 'checking', reason: null }
let snapshot = { ...store }
const listeners = new Set()

function emit() {
  snapshot = { ...store }
  listeners.forEach((listener) => listener())
}

export const subscribe = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export const getSnapshot = () => snapshot
export const getAccessToken = () => store.accessToken

export function setSession({ accessToken, user }) {
  Object.assign(store, { accessToken, user, status: 'authenticated', reason: null })
  emit()
}

export function clearSession(reason = null) {
  Object.assign(store, { accessToken: null, user: null, status: 'anonymous', reason })
  emit()
}

// La sesion se perdio sin que el usuario lo pidiera (refresh rechazado)
export const expireSession = () => clearSession('expired')

// El backend revoca TODAS las sesiones si un refresh token se reutiliza, asi que nunca
// debe haber dos renovaciones en vuelo: una promesa compartida en esta pestana y un
// candado de navegador (Web Locks) entre pestanas.
const withLock = (fn) =>
  typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request('gastrocore-refresh', fn)
    : fn()

let refreshPromise = null

export function refreshSession() {
  refreshPromise ??= withLock(async () => {
    const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
    const body = await readBody(res)
    if (!res.ok) throw toApiError(res, body)
    setSession(body)
    return body
  }).finally(() => {
    refreshPromise = null
  })
  return refreshPromise
}

// Al abrir o recargar la app: intenta recuperar la sesion con la cookie (una sola vez)
let restorePromise = null

export function restoreSession() {
  restorePromise ??= refreshSession().catch(() => clearSession())
  return restorePromise
}

// Solo para pruebas
export function resetSessionForTests() {
  Object.assign(store, { accessToken: null, user: null, status: 'checking', reason: null })
  refreshPromise = null
  restorePromise = null
  emit()
}
