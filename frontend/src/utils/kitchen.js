export const ALERT_AFTER_MS = 15 * 60 * 1000

export const KITCHEN_STATUSES = ['pendiente', 'en_preparacion', 'listo']

const elapsedSince = (date, now) => Math.max(0, now - new Date(date).getTime())

// Una tarjeta por ronda y estado: una ronda con items en estados distintos aparece en varias columnas.
// Las rondas ya llegan de la mas antigua a la mas nueva, asi que cada columna queda cronologica.
export function buildColumns(rounds) {
  const columns = Object.fromEntries(KITCHEN_STATUSES.map((status) => [status, []]))
  for (const round of rounds) {
    for (const status of KITCHEN_STATUSES) {
      const items = round.items.filter((item) => item.status === status)
      if (items.length === 0) continue
      columns[status].push({
        key: `${round.roundId}:${status}`,
        roundId: round.roundId,
        tableNumber: round.tableNumber,
        createdAt: round.createdAt,
        status,
        items,
      })
    }
  }
  return columns
}

export function countByStatus(rounds) {
  const counts = Object.fromEntries(KITCHEN_STATUSES.map((status) => [status, 0]))
  for (const round of rounds) {
    for (const item of round.items) {
      if (item.status in counts) counts[item.status] += 1
    }
  }
  return counts
}

// Tiempo desde que la ronda llego a cocina. En "listo" se congela en lo que tardo el ultimo item.
export function cardElapsedMs(card, now) {
  if (card.status !== 'listo') return elapsedSince(card.createdAt, now)
  const lastReady = Math.max(...card.items.map((item) => new Date(item.readyAt ?? now).getTime()))
  return elapsedSince(card.createdAt, lastReady)
}

// Un item listo ya salio de la cola: la alerta es solo para lo que sigue sin terminar.
export function isItemDelayed(item, now) {
  return item.status !== 'listo' && elapsedSince(item.createdAt, now) >= ALERT_AFTER_MS
}

export function formatElapsed(ms) {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

export function formatClock(now) {
  return new Date(now).toLocaleTimeString('es-CO', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

// Una ronda ya conocida no se duplica: el evento puede llegar despues de una recarga que ya la trajo.
export function addRound(rounds, round) {
  if (rounds.some((current) => current.roundId === round.roundId)) return rounds
  return [...rounds, round].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )
}

// Aplica item:status_changed o la respuesta del PUT, lo que llegue primero. Lo mas viejo no pisa lo
// mas nuevo. Entregado o cancelado salen de cocina, y una ronda sin items desaparece.
export function applyItemChange(rounds, changed) {
  const remaining = KITCHEN_STATUSES.includes(changed.status)
  return rounds
    .map((round) => {
      if (round.roundId !== changed.roundId) return round
      const current = round.items.find((item) => item.itemId === changed.itemId)
      if (current && new Date(changed.updatedAt) < new Date(current.updatedAt)) return round
      if (!remaining) {
        return { ...round, items: round.items.filter((item) => item.itemId !== changed.itemId) }
      }
      return {
        ...round,
        items: round.items.map((item) =>
          item.itemId === changed.itemId ? { ...item, ...changed } : item,
        ),
      }
    })
    .filter((round) => round.items.length > 0)
}
