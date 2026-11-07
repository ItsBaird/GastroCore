import { api } from './client.js'

export const listKitchenRounds = () => api('/api/orders/kitchen')

export const updateItemStatus = (itemId, status) =>
  api(`/api/orders/items/${itemId}/status`, { method: 'PUT', body: { status } })

// Cuanto va adelantado el servidor respecto a este dispositivo, en ms. Los tiempos de cocina se miden
// contra el servidor: un reloj mal puesto en la tablet no debe disparar ni esconder la alerta de 15 min.
// Va con fetch directo porque client.js no expone cabeceras. Si falla, se usa el reloj local.
export async function fetchServerClockOffset() {
  try {
    const res = await fetch('/api/orders/health', { credentials: 'same-origin' })
    const serverTime = Date.parse(res.headers.get('date'))
    return Number.isNaN(serverTime) ? 0 : serverTime - Date.now()
  } catch {
    return 0
  }
}
