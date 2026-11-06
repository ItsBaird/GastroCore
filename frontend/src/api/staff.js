import { api } from './client.js'

export const listEmployees = () => api('/api/staff/employees')

// El userId viene de Auth (el usuario ya creado); hireDate va como AAAA-MM-DD
export const createEmployee = (values) => api('/api/staff/employees', { method: 'POST', body: values })

// Solo se envian los campos que cambian; el userId no se puede modificar
export const updateEmployee = (userId, changes) =>
  api(`/api/staff/employees/${userId}`, { method: 'PUT', body: changes })
