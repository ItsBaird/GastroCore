import { expireSession, getAccessToken, refreshSession } from '../auth/session.js'
import { ApiError, readBody, toApiError } from './errors.js'

function send(path, { method, body, auth }) {
  const token = auth ? getAccessToken() : null
  return fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

// Cliente HTTP. Con auth=true agrega el access token y, si el servidor responde 401,
// renueva la sesion UNA vez y reintenta. Si la renovacion es rechazada, la sesion expira.
export async function api(path, { method = 'GET', body, auth = true } = {}) {
  let res
  try {
    res = await send(path, { method, body, auth })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'No se pudo conectar con el servidor')
  }

  if (res.status === 401 && auth) {
    try {
      await refreshSession()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) expireSession()
      throw err instanceof ApiError ? err : new ApiError(0, 'NETWORK_ERROR', 'No se pudo conectar con el servidor')
    }
    try {
      res = await send(path, { method, body, auth })
    } catch {
      throw new ApiError(0, 'NETWORK_ERROR', 'No se pudo conectar con el servidor')
    }
    if (res.status === 401) expireSession()
  }

  const data = await readBody(res)
  if (!res.ok) throw toApiError(res, data)
  return data
}
