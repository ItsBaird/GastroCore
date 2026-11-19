import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { getAccessToken, refreshSession } from '../auth/session.js'

// La pantalla de cocina pasa horas abierta, asi que aqui, a diferencia de useRealtimeEvent, importa
// lo que ocurre al perder la conexion: avisa el estado y pide recargar al volver, porque los eventos
// emitidos mientras no habia conexion se pierden. El token dura 15 minutos: si el servidor rechaza
// la reconexion por token vencido, Socket.io no reintenta solo, y aqui se renueva y se reconecta.
export function useKitchenSocket({ onRoundCreated, onItemChanged, onReconnected }) {
  const [connected, setConnected] = useState(true)
  const handlers = useRef({ onRoundCreated, onItemChanged, onReconnected })

  useEffect(() => {
    handlers.current = { onRoundCreated, onItemChanged, onReconnected }
  })

  useEffect(() => {
    if (!getAccessToken()) return undefined

    const socket = io({
      auth: (send) => send({ token: getAccessToken() }),
      transports: ['websocket'],
    })
    let hasConnected = false

    socket.on('connect', () => {
      setConnected(true)
      if (hasConnected) handlers.current.onReconnected?.()
      hasConnected = true
    })
    socket.on('disconnect', () => setConnected(false))
    socket.on('connect_error', async () => {
      setConnected(false)
      if (socket.active) return
      try {
        await refreshSession()
        socket.connect()
      } catch {
        // Sesion vencida: la siguiente peticion a la API lleva a iniciar sesion
      }
    })
    socket.on('round:created', (round) => handlers.current.onRoundCreated?.(round))
    socket.on('item:status_changed', (item) => handlers.current.onItemChanged?.(item))

    return () => {
      socket.disconnect()
    }
  }, [])

  return { connected }
}
