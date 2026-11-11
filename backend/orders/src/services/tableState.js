// Estado derivado de una mesa (la tabla dining_tables no guarda estado): sale de su orden sin cerrar.
//   sin orden abierta -> 'libre';  orden EN_COBRO -> 'en_cobro';  orden ABIERTA -> 'ocupada'.
// Funcion pura y unica: la usan el panel del mesero (GET /tables/status) y el canal QR (GET /qr/:token),
// asi los dos ven siempre el mismo estado. `orders` son las ordenes no cerradas de la mesa (a lo sumo una,
// por el indice uix_orders_one_open_per_table).
export function deriveTableStatus(orders) {
  if (!orders || orders.length === 0) return 'libre';
  if (orders[0].status === 'EN_COBRO') return 'en_cobro';
  return 'ocupada';
}
