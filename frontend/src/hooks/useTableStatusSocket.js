import { useEffect, useRef } from 'react'
import { getAccessToken } from '../auth/session.js'

const MODULE_ID = 'socket.io-client'

export function useTableStatusSocket(onStatusChanged) {
  const cbRef = useRef(onStatusChanged)
  cbRef.current = onStatusChanged

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

      socket.on('table:status_changed', (data) => {
        cbRef.current?.(data)
      })
    }

    connect()

    return () => {
      cancelled = true
      socket?.disconnect()
    }
  }, [])
}
