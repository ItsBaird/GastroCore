import { callWaiter, requestBill } from '../api/qr.js'
import { NOTIFIED_MS, useServiceCall } from './useServiceCall.js'

export { NOTIFIED_MS }

// GC-QR-0002. "Llamar al mesero": la sala a la que llega el aviso la decide el servidor.
export function useCallWaiter(qrToken, options) {
  return useServiceCall(callWaiter, qrToken, options)
}

// GC-QR-0004 (GC-148). "Pedir la cuenta": solo con la mesa ocupada; el aviso llega solo al mesero de la orden.
// Si la mesa ya paso a cobro o se libero entre la consulta y el clic (409), onStale vuelve a consultar el estado.
export function useRequestBill(qrToken, options) {
  return useServiceCall(requestBill, qrToken, options)
}
