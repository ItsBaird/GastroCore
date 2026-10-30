import { useEffect, useRef } from 'react'
import { getAccessToken } from '../auth/session.js'

export function useTableStatusSocket(onStatusChanged) {
  const cbRef = useRef(onStatusChanged)
  cbRef.current = onStatusChanged

  useEffect(() => {
    let socket = null
    let cancelled = false

    async function connect() {
      let io
      try {
        ;({ io } = await import('socket.io-client'))
      } catch {
        return
      }
      if (cancelled) return

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
