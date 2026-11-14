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

// Varios eventos en UNA sola conexion (useRealtimeEvent abre un socket por evento). `handlers` es
// { evento: manejador }; los nombres de evento deben ser estables entre renders. Mismo manejo de token
// vencido y de reconexion que useRealtimeEvent.
export function useRealtimeEvents(handlers, { onReconnect } = {}) {
  const handlersRef = useRef(handlers)
  const reconnectRef = useRef(onReconnect)
  const names = Object.keys(handlers).sort().join('|')

  useEffect(() => {
    handlersRef.current = handlers
    reconnectRef.current = onReconnect
  })

  useEffect(() => {
    if (!getAccessToken()) return undefined
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
    for (const name of names.split('|')) {
      socket.on(name, (data) => handlersRef.current[name]?.(data))
    }
    return () => {
      socket.disconnect()
    }
  }, [names])
}
