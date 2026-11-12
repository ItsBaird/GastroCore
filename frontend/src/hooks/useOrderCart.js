import { useCallback, useMemo, useReducer } from 'react'

// GC-QR-0003. Carrito "Mi Pedido" del cliente, solo en memoria (recargar lo vacia; nada en storage).
// Los limites son los del backend (qrRequest.schema.js de Oscar) y aqui solo ayudan a no llegar al 400:
// el servidor los vuelve a validar.
export const MAX_LINES = 20
export const MAX_QUANTITY = 99
export const MAX_NOTE = 255

const lineKey = (productId, note) => `${productId}::${note.trim()}`

function reducer(lines, action) {
  switch (action.type) {
    case 'add': {
      const { product, quantity, note } = action
      const key = lineKey(product.productId, note)
      const existing = lines.find((l) => l.key === key)
      if (existing) {
        return lines.map((l) =>
          l.key === key
            ? { ...l, quantity: Math.min(MAX_QUANTITY, l.quantity + quantity), problem: null }
            : l,
        )
      }
      if (lines.length >= MAX_LINES) return lines
      return [
        ...lines,
        {
          key,
          productId: product.productId,
          name: product.name,
          // Solo para mostrar el valor referencial: nunca se envia (R4)
          price: product.price,
          quantity: Math.min(MAX_QUANTITY, quantity),
          note: note.trim(),
          problem: null,
        },
      ]
    }
    case 'quantity':
      return lines.map((l) =>
        l.key === action.key
          ? { ...l, quantity: Math.max(1, Math.min(MAX_QUANTITY, action.quantity)), problem: null }
          : l,
      )
    case 'note':
      return lines.map((l) =>
        l.key === action.key ? { ...l, note: action.note.slice(0, MAX_NOTE), problem: null } : l,
      )
    case 'remove':
      return lines.filter((l) => l.key !== action.key)
    case 'problems':
      return lines.map((l) => ({ ...l, problem: action.problems[l.key] ?? null }))
    case 'clear':
      return []
    default:
      return lines
  }
}

export function useOrderCart() {
  const [lines, dispatch] = useReducer(reducer, [])

  const add = useCallback(
    (product, quantity, note = '') => dispatch({ type: 'add', product, quantity, note }),
    [],
  )
  const setQuantity = useCallback(
    (key, quantity) => dispatch({ type: 'quantity', key, quantity }),
    [],
  )
  const setNote = useCallback((key, note) => dispatch({ type: 'note', key, note }), [])
  const remove = useCallback((key) => dispatch({ type: 'remove', key }), [])
  const markProblems = useCallback((problems) => dispatch({ type: 'problems', problems }), [])
  const clear = useCallback(() => dispatch({ type: 'clear' }), [])

  const units = useMemo(() => lines.reduce((sum, l) => sum + l.quantity, 0), [lines])
  // Valor referencial con los precios del menu publico; el mesero confirma y el backend toma el precio real
  const referenceTotal = useMemo(
    () => lines.reduce((sum, l) => sum + l.price * l.quantity, 0),
    [lines],
  )

  return {
    lines,
    units,
    referenceTotal,
    full: lines.length >= MAX_LINES,
    add,
    setQuantity,
    setNote,
    remove,
    markProblems,
    clear,
  }
}
