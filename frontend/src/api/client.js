let getToken = () => null

export function setTokenGetter(fn) {
  getToken = fn
}

export async function apiFetch(path, options = {}) {
  const token = getToken()
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(path, { ...options, headers })
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null

  if (!res.ok) {
    const err = new Error(body?.error?.message || `Error ${res.status}`)
    err.status = res.status
    err.code = body?.error?.code
    err.details = body?.error?.details
    throw err
  }

  return body
}
