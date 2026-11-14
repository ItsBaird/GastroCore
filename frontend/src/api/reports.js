import { api } from './client.js'

// GC-RPT-0001. Solo lectura, solo ADMIN. `date` es AAAA-MM-DD, el dia del restaurante (hora de Colombia).
// Un dia sin ordenes cerradas no es un error: responde ceros y listas vacias.
// Trae ids, no nombres: los de metodos de pago y meseros se resuelven aparte.
export const getCashClosePreview = (date) =>
  api(`/api/orders/reports/cash-close?date=${encodeURIComponent(date)}`)
