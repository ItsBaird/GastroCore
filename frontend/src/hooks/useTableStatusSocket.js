import { useRealtimeEvent } from './useRealtimeEvent.js'

// Estado de una mesa recalculado por el backend (abrir mesa, anular un item, cobrar...).
export function useTableStatusSocket(onStatusChanged) {
  useRealtimeEvent('table:status_changed', onStatusChanged)
}
