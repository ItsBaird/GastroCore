const byNumber = (a, b) => a.tableNumber - b.tableNumber

// Mesas de un estado en el orden de "Mis Mesas": primero las del mesero de la sesion (las que puede usar), luego
// las de los demas meseros; cada grupo por numero de mesa. Las libres no tienen mesero: quedan solo por numero.
export function sortForSection(tables, status, userId) {
  const own = tables.filter((t) => t.status === status && t.waiterId === userId).sort(byNumber)
  const rest = tables.filter((t) => t.status === status && t.waiterId !== userId).sort(byNumber)
  return [...own, ...rest]
}
