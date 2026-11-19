import { io } from 'socket.io-client'

// URL del servidor de sockets (Orders) a partir de VITE_WS_URL. En produccion el frontend esta en Vercel, que NO
// reenvia websockets, asi que el socket va directo a Orders en Render (por ejemplo https://orders.onrender.com).
// Sin la variable (local) devuelve undefined: el socket usa el mismo origen de la pagina, como siempre (nginx o el
// proxy de Vite lo pasan a Orders). Se toma solo el origen: en Socket.io una ruta en la URL se interpretaria como
// un namespace (por ejemplo /api) y el socket no recibiria nada.
export function socketUrl(raw = import.meta.env.VITE_WS_URL) {
  const value = raw?.trim()
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('protocolo')
    return url.origin
  } catch {
    // Configuracion invalida: se avisa y se usa el mismo origen, en vez de dejar la app sin tiempo real
    console.error(`VITE_WS_URL no es una URL http(s) valida: "${value}". Se usa el mismo origen.`)
    return undefined
  }
}

// Abre el socket con las opciones de siempre, hacia VITE_WS_URL si esta definida o al mismo origen si no
export function connectSocket(options, url = socketUrl()) {
  return url ? io(url, options) : io(options)
}
