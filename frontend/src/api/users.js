import { api } from './client.js'

export const listUsers = () => api('/api/auth/users')

export const createUser = ({ email, password, role }) =>
  api('/api/auth/register', { method: 'POST', body: { email, password, role } })

// Solo cambia rol y estado (REQ-F01-07)
export const updateUser = (userId, changes) =>
  api(`/api/auth/users/${userId}`, { method: 'PUT', body: changes })

// Desactivacion logica: no borra el registro y revoca las sesiones del usuario
export const deactivateUser = (userId) => api(`/api/auth/users/${userId}`, { method: 'DELETE' })
