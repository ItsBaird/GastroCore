export const ROLE_OPTIONS = [
  { value: 'ADMIN', label: 'Administrador' },
  { value: 'WAITER', label: 'Mesero' },
  { value: 'COOK', label: 'Cocinero' },
]

export const roleLabel = (role) => ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role

const capitalize = (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()

// Auth solo guarda el email. El nombre real vive en Staff (employees.full_name),
// asi que por ahora se deriva del email: "maria.garcia@..." -> "Maria Garcia"
export function displayName(email = '') {
  const local = email.split('@')[0]
  const words = local.split(/[._-]+/).filter((w) => w && !/^\d+$/.test(w))
  return (words.length ? words : [local]).map(capitalize).join(' ')
}

export const initial = (email = '') => displayName(email).charAt(0).toUpperCase() || '?'

export function countByRole(users) {
  const counts = { total: users.length, ADMIN: 0, WAITER: 0, COOK: 0 }
  users.forEach((u) => {
    if (u.role in counts) counts[u.role] += 1
  })
  return counts
}

// Texto para el login segun el codigo de error del backend
export function loginErrorMessage(err) {
  switch (err?.code) {
    case 'UNAUTHENTICATED':
      return 'Correo o contraseña incorrectos'
    case 'ACCOUNT_LOCKED': {
      const until = err.details?.lockedUntil && new Date(err.details.lockedUntil)
      const hour = until?.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
      return hour
        ? `Cuenta bloqueada temporalmente. Podrás intentarlo de nuevo a las ${hour}.`
        : 'Cuenta bloqueada temporalmente. Inténtalo más tarde.'
    }
    case 'RATE_LIMITED':
      return 'Demasiados intentos. Espera un minuto e inténtalo de nuevo.'
    case 'VALIDATION_ERROR':
      return 'Revisa el correo y la contraseña.'
    default:
      return 'No se pudo conectar con el servidor. Inténtalo de nuevo.'
  }
}
