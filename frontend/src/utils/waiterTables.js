// Estados de mesa compartidos por "Mis Mesas" (mesero) y la Gestion de Mesas (ADMIN)
export const TABLE_STATUS = {
  libre: { label: 'Libre', className: 'ts-card--libre' },
  ocupada: { label: 'Ocupada', className: 'ts-card--ocupada' },
  // El Figma rotula "Ocupada" la tarjeta en cobro: es un copiado; la etiqueta sigue el estado
  en_cobro: { label: 'En cobro', className: 'ts-card--en-cobro' },
}

// Secciones por estado, en este orden (Figma 31:63, 152:33, 152:35)
export const TABLE_SECTIONS = [
  { status: 'libre', title: 'Mesas: Libres', empty: 'No hay mesas libres.' },
  { status: 'ocupada', title: 'Mesas: Ocupadas', empty: 'No hay mesas ocupadas.' },
  { status: 'en_cobro', title: 'Mesas: En Cobro', empty: 'No hay mesas en cobro.' },
]

const byNumber = (a, b) => a.tableNumber - b.tableNumber

// Mesas de un estado en el orden de "Mis Mesas": primero las del mesero de la sesion (las que puede usar), luego
// las de los demas meseros; cada grupo por numero de mesa. Las libres no tienen mesero: quedan solo por numero.
export function sortForSection(tables, status, userId) {
  const own = tables.filter((t) => t.status === status && t.waiterId === userId).sort(byNumber)
  const rest = tables.filter((t) => t.status === status && t.waiterId !== userId).sort(byNumber)
  return [...own, ...rest]
}
