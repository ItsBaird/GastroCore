import { useEffect, useState } from 'react'
import { listShifts } from '../api/staff.js'
import { mondayOf, todayKey } from '../utils/shift.js'

// null mientras no se sabe: la insignia no debe afirmar nada hasta tener respuesta del servidor.
export function useActiveShift(userId, enabled = true) {
  const [active, setActive] = useState(null)

  useEffect(() => {
    if (!enabled || !userId) return undefined
    let current = true
    listShifts({ week: mondayOf(todayKey()), userId }).then(
      (shifts) => current && setActive(shifts.some((s) => s.status === 'activo')),
      () => current && setActive(null),
    )
    return () => {
      current = false
    }
  }, [userId, enabled])

  return active
}
