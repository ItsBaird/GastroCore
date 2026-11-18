import { isValidDay, nameOf, todayLocal } from './cashClose.js'

// GC-RPT-0003. Utilidades del historial de ventas: filtros por defecto, validacion del rango (la misma regla que el
// backend, para avisar antes de pedir), referencia y nombres para mostrar.

export const HISTORY_PAGE_SIZE = 20
export const MAX_HISTORY_DAYS = 366

export const UNKNOWN_WAITER = 'Sin perfil de empleado'
export const UNKNOWN_METHOD = 'Método sin nombre'

const DAY_MS = 24 * 60 * 60 * 1000

// Filtros iniciales: el dia de HOY (hora local del navegador, que es la del restaurante) y sin mas filtros.
// Los selectores usan '' como "todos".
export function defaultHistoryFilters(now = new Date()) {
  const today = todayLocal(now)
  return { from: today, to: today, waiterId: '', tableId: '', paymentMethodId: '' }
}

// Dias de `from` a `to`, contando ambos (14-nov a 14-nov = 1)
export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1
}

// Mensaje si el rango no se puede pedir (null si esta bien). Mismas reglas que el backend: fechas reales, desde no
// posterior a hasta y como mucho 366 dias contando ambos extremos.
export function historyRangeError({ from, to }) {
  if (!isValidDay(from) || !isValidDay(to)) return 'Elige una fecha desde y una fecha hasta.'
  if (from > to) return 'La fecha desde no puede ser posterior a la fecha hasta.'
  if (daysBetween(from, to) > MAX_HISTORY_DAYS) {
    return `El rango no puede pasar de ${MAX_HISTORY_DAYS} días.`
  }
  return null
}

// Dos juegos de filtros piden lo mismo
export function sameFilters(a, b) {
  return ['from', 'to', 'waiterId', 'tableId', 'paymentMethodId'].every(
    (key) => (a[key] ?? '') === (b[key] ?? ''),
  )
}

// La referencia que muestra la pantalla: '#3F9A1C'. El backend la manda sin '#'; si faltara, se deriva del id
// (6 primeros caracteres del UUID en mayusculas, la misma regla del backend).
export function formatReference(reference, orderId = '') {
  const ref = reference || orderId.slice(0, 6).toUpperCase()
  return ref ? `#${ref}` : ''
}

export const tableLabel = (tableNumber) => `Mesa ${tableNumber}`

// Nombres a partir de las listas que ya usa la app: empleados de Staff (userId, fullName) y metodos de pago de
// Orders (paymentMethodId, name). Si una lista no cargo, el nombre generico: los montos no dependen de eso.
export const waiterName = (employees, userId) =>
  nameOf(employees, 'userId', 'fullName', userId, UNKNOWN_WAITER)
export const methodName = (methods, paymentMethodId) =>
  nameOf(methods, 'paymentMethodId', 'name', paymentMethodId, UNKNOWN_METHOD)

// Opciones de los selectores de filtro, ordenadas para buscar a ojo: mesas por numero, meseros y metodos por nombre
export function filterOptions({ tables = [], employees = [], methods = [] }) {
  const byLabel = (a, b) => a.label.localeCompare(b.label, 'es')
  return {
    tables: [...tables]
      .sort((a, b) => a.tableNumber - b.tableNumber)
      .map((t) => ({ value: t.tableId, label: tableLabel(t.tableNumber) })),
    waiters: employees.map((e) => ({ value: e.userId, label: e.fullName })).sort(byLabel),
    methods: methods.map((m) => ({ value: m.paymentMethodId, label: m.name })).sort(byLabel),
  }
}

// Guarda un archivo descargado (el .xlsx) con su nombre: enlace temporal que se pulsa y se libera
export function saveFile(blob, fileName, doc = document) {
  const url = URL.createObjectURL(blob)
  const link = doc.createElement('a')
  link.href = url
  link.download = fileName
  doc.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
