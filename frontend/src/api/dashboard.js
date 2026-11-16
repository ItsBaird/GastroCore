import { api } from './client.js'

// GC-RPT-0004. Solo lectura, solo ADMIN. Sin rango, el backend usa la semana en curso (lunes a domingo, hora de
// Colombia). `from`/`to` son AAAA-MM-DD, ambos incluidos, hasta 92 dias. Trae ids de meseros y metodos, no
// nombres: se resuelven aparte, como en el cierre de caja.
export function getDashboard({ from, to } = {}) {
  const query = from && to ? `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` : ''
  return api(`/api/orders/reports/dashboard${query}`)
}
