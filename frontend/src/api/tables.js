import { apiFetch } from './client.js'

export function listTables() {
  return apiFetch('/api/orders/tables')
}

export function createTable(data) {
  return apiFetch('/api/orders/tables', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function updateTable(id, data) {
  return apiFetch(`/api/orders/tables/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}
