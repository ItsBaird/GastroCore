import { api } from './client.js'

export const loginRequest = (email, password) =>
  api('/api/auth/login', { method: 'POST', body: { email, password }, auth: false })

export const logoutRequest = () => api('/api/auth/logout', { method: 'POST', auth: false })
