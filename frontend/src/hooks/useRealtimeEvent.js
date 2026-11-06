import { useEffect, useRef } from 'react'
import { getAccessToken } from '../auth/session.js'

// El import es dinamico y con variable para que Vite no lo analice: socket.io-client puede no
// estar instalado, y en ese caso el hook simplemente no conecta (la pagina sigue funcionando
// con la carga por HTTP). El token viaja en el handshake, nunca en localStorage.
const MODULE_ID = 'socket.io-client'

export function useRealtimeEvent(eventName, onEvent) {
  const cbRef = useRef(onEvent)
  cbRef.current = onEvent

  useEffect(() => {
    let socket = null
    let cancelled = false

    async function connect() {
      let io
      try {
        const mod = await import(/* @vite-ignore */ MODULE_ID)
        io = mod.io ?? mod.default
      } catch {
        return
      }
      if (cancelled || !io) return

      const token = getAccessToken()
      if (!token) return

      socket = io({ auth: { token }, transports: ['websocket'] })
      socket.on(eventName, (data) => {
        cbRef.current?.(data)
      })
    }

    connect()

    return () => {
      cancelled = true
      socket?.disconnect()
    }
  }, [eventName])
}
