import { useEffect, useRef } from 'react'
import { io } from 'socket.io-client'
import { getAccessToken } from '../auth/session.js'

export function useRealtimeEvent(eventName, onEvent) {
  const cbRef = useRef(onEvent)
  cbRef.current = onEvent

  useEffect(() => {
    if (!getAccessToken()) return undefined

    // auth como funcion: al reconectar toma el token vigente, que dura solo 15 minutos
    const socket = io({
      auth: (send) => send({ token: getAccessToken() }),
      transports: ['websocket'],
    })
    socket.on(eventName, (data) => {
      cbRef.current?.(data)
    })

    return () => {
      socket.disconnect()
    }
  }, [eventName])
}
