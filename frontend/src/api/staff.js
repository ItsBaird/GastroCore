import { api } from './client.js'

export const listEmployees = () => api('/api/staff/employees')

// El userId viene de Auth (el usuario ya creado); hireDate va como AAAA-MM-DD
export const createEmployee = (values) => api('/api/staff/employees', { method: 'POST', body: values })

// Solo se envian los campos que cambian; el userId no se puede modificar
export const updateEmployee = (userId, changes) =>
  api(`/api/staff/employees/${userId}`, { method: 'PUT', body: changes })

// Turnos. `week` es cualquier fecha (AAAA-MM-DD) de la semana; `userId` filtra por empleado.
export function listShifts({ week, userId } = {}) {
  const params = new URLSearchParams()
  if (week) params.set('week', week)
  if (userId) params.set('userId', userId)
  const query = params.toString()
  return api(`/api/staff/shifts${query ? `?${query}` : ''}`)
}

// scheduledStart / scheduledEnd son fechas ISO 8601 con zona horaria; el servidor exige fin > inicio
export const createShift = (values) => api('/api/staff/shifts', { method: 'POST', body: values })

// Inicio y fin de turno. Los hace el propio empleado (el fin tambien un ADMIN) y el servidor valida
// la hora del rango programado (inicio) y las mesas abiertas en Orders (fin).
export const startShift = (shiftId) => api(`/api/staff/shifts/${shiftId}/start`, { method: 'POST' })
export const endShift = (shiftId) => api(`/api/staff/shifts/${shiftId}/end`, { method: 'POST' })
