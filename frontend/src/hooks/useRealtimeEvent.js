import { useEffect, useRef } from 'react'
import { io } from 'socket.io-client'
import { getAccessToken, refreshSession } from '../auth/session.js'

// onReconnect (opcional): los eventos emitidos mientras no habia conexion se pierden, asi que la
// pantalla que lo pase recarga sus datos al volver. El token dura 15 minutos: si el servidor rechaza
// la reconexion por token vencido, Socket.io no reintenta solo, y aqui se renueva y se reconecta
// (mismo criterio que useKitchenSocket).
export function useRealtimeEvent(eventName, onEvent, { onReconnect } = {}) {
  const cbRef = useRef(onEvent)
  const reconnectRef = useRef(onReconnect)

  // Siempre el manejador mas reciente, sin reabrir el socket en cada render
  useEffect(() => {
    cbRef.current = onEvent
    reconnectRef.current = onReconnect
  })

  useEffect(() => {
    if (!getAccessToken()) return undefined

    // auth como funcion: al reconectar toma el token vigente
    const socket = io({
      auth: (send) => send({ token: getAccessToken() }),
      transports: ['websocket'],
    })
    let hasConnected = false

    socket.on('connect', () => {
      if (hasConnected) reconnectRef.current?.()
      hasConnected = true
    })
    socket.on('connect_error', async () => {
      if (socket.active) return
      try {
        await refreshSession()
        socket.connect()
      } catch {
        // Sesion vencida: la siguiente peticion a la API lleva a iniciar sesion
      }
    })
    socket.on(eventName, (data) => {
      cbRef.current?.(data)
    })

    return () => {
      socket.disconnect()
    }
  }, [eventName])
}
