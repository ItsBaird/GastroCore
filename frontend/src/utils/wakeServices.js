// Despertar los servicios al abrir la app. En Render gratis un servicio se apaga tras 15 minutos sin uso y tarda
// ~50 s en volver: si se espera al primer clic, el usuario ve la app colgada (o un error si el servicio llama a
// otro que tambien esta dormido). Al cargar la pagina se pide /health a cada servicio en segundo plano: mientras el
// usuario escribe su contrasena o mira el menu, ya estan despertando.
//   - App con sesion: los 4 servicios.
//   - Vista publica del QR (/m/...): solo Catalog (menu) y Orders (mesa, llamados, pedidos), que es lo que usa.
// Las llamadas no llevan cookies ni token, no bloquean nada y sus errores se ignoran (en local los servicios ya
// estan despiertos y esto no cambia nada). Cada servicio se despierta una sola vez por carga de la pagina.

export const SESSION_APP_SERVICES = ['auth', 'staff', 'catalog', 'orders']
export const PUBLIC_QR_SERVICES = ['catalog', 'orders']

// Lo que tarda como mucho en despertar un servicio de Render gratis, con margen
export const WAKE_TIMEOUT_MS = 90_000

const requested = new Set()

export function wakeServices(services, { fetchImpl = globalThis.fetch } = {}) {
  const pending = services.filter((service) => !requested.has(service))
  for (const service of pending) requested.add(service)

  return Promise.allSettled(
    pending.map((service) =>
      fetchImpl(`/api/${service}/health`, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        signal: AbortSignal.timeout(WAKE_TIMEOUT_MS),
      }),
    ),
  )
}

// Solo para pruebas: olvidar que servicios ya se pidieron
export function resetWakeServices() {
  requested.clear()
}
