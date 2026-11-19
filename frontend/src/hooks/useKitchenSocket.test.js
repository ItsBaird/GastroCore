import { act, renderHook, waitFor } from '@testing-library/react'
import { io } from 'socket.io-client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAccessToken, refreshSession } from '../auth/session.js'
import { useKitchenSocket } from './useKitchenSocket.js'

vi.mock('socket.io-client', () => ({ io: vi.fn() }))
vi.mock('../auth/session.js', () => ({ getAccessToken: vi.fn(), refreshSession: vi.fn() }))

let listeners
let socket

const fire = (event, ...args) => act(async () => listeners[event]?.(...args))

beforeEach(() => {
  vi.resetAllMocks()
  listeners = {}
  socket = {
    active: true,
    on: vi.fn((event, cb) => {
      listeners[event] = cb
    }),
    connect: vi.fn(),
    disconnect: vi.fn(),
  }
  io.mockReturnValue(socket)
  getAccessToken.mockReturnValue('token-1')
})

describe('useKitchenSocket', () => {
  it('sin token no abre conexion', () => {
    getAccessToken.mockReturnValue(null)

    renderHook(() => useKitchenSocket({}))

    expect(io).not.toHaveBeenCalled()
  })

  it('abre un solo socket y lo cierra al desmontar', () => {
    const { rerender, unmount } = renderHook(() => useKitchenSocket({}))
    rerender()

    expect(io).toHaveBeenCalledTimes(1)
    unmount()
    expect(socket.disconnect).toHaveBeenCalled()
  })

  it('toma el token vigente en cada conexion', () => {
    renderHook(() => useKitchenSocket({}))
    const { auth } = io.mock.calls[0][0]
    getAccessToken.mockReturnValue('token-2')
    const send = vi.fn()

    auth(send)

    expect(send).toHaveBeenCalledWith({ token: 'token-2' })
  })

  it('entrega los eventos al manejador mas reciente', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ cb }) => useKitchenSocket({ onItemChanged: cb }), {
      initialProps: { cb: first },
    })
    rerender({ cb: second })

    await fire('item:status_changed', { itemId: 'i1' })

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith({ itemId: 'i1' })
  })

  it('entrega las rondas nuevas', async () => {
    const onRoundCreated = vi.fn()
    renderHook(() => useKitchenSocket({ onRoundCreated }))

    await fire('round:created', { roundId: 'r1' })

    expect(onRoundCreated).toHaveBeenCalledWith({ roundId: 'r1' })
  })

  it('pide recargar al reconectar, no en la primera conexion', async () => {
    const onReconnected = vi.fn()
    renderHook(() => useKitchenSocket({ onReconnected }))

    await fire('connect')
    expect(onReconnected).not.toHaveBeenCalled()

    await fire('disconnect')
    await fire('connect')
    expect(onReconnected).toHaveBeenCalledTimes(1)
  })

  it('informa si hay conexion', async () => {
    const { result } = renderHook(() => useKitchenSocket({}))
    expect(result.current.connected).toBe(true)

    await fire('disconnect')
    expect(result.current.connected).toBe(false)

    await fire('connect')
    expect(result.current.connected).toBe(true)
  })

  it('si el servidor rechaza el token, renueva la sesion y reconecta', async () => {
    socket.active = false
    refreshSession.mockResolvedValue({})
    const { result } = renderHook(() => useKitchenSocket({}))

    await fire('connect_error', new Error('Token invalido'))

    expect(result.current.connected).toBe(false)
    expect(refreshSession).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(socket.connect).toHaveBeenCalledTimes(1))
  })

  it('un corte de red lo reintenta Socket.io, sin renovar la sesion', async () => {
    socket.active = true
    renderHook(() => useKitchenSocket({}))

    await fire('connect_error', new Error('xhr poll error'))

    expect(refreshSession).not.toHaveBeenCalled()
    expect(socket.connect).not.toHaveBeenCalled()
  })

  it('si la sesion ya vencio no reconecta ni rompe', async () => {
    socket.active = false
    refreshSession.mockRejectedValue(new Error('401'))
    renderHook(() => useKitchenSocket({}))

    await fire('connect_error', new Error('Token invalido'))

    expect(socket.connect).not.toHaveBeenCalled()
  })
})
