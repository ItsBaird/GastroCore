import { act, renderHook, waitFor } from '@testing-library/react'
import { io } from 'socket.io-client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAccessToken, refreshSession } from '../auth/session.js'
import { useRealtimeEvent, useRealtimeEvents } from './useRealtimeEvent.js'

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

describe('useRealtimeEvent', () => {
  it('entrega el evento al manejador y cierra el socket al desmontar', async () => {
    const onEvent = vi.fn()
    const { unmount } = renderHook(() => useRealtimeEvent('item:status_changed', onEvent))

    await fire('item:status_changed', { itemId: 'i1' })

    expect(onEvent).toHaveBeenCalledWith({ itemId: 'i1' })
    unmount()
    expect(socket.disconnect).toHaveBeenCalled()
  })

  it('no llama onReconnect en la primera conexion, si en las siguientes', async () => {
    const onReconnect = vi.fn()
    renderHook(() => useRealtimeEvent('item:status_changed', vi.fn(), { onReconnect }))

    await fire('connect')
    expect(onReconnect).not.toHaveBeenCalled()

    await fire('connect')
    expect(onReconnect).toHaveBeenCalledOnce()
  })

  it('sin onReconnect una reconexion no falla', async () => {
    renderHook(() => useRealtimeEvent('table:status_changed', vi.fn()))

    await fire('connect')
    await fire('connect')

    expect(io).toHaveBeenCalledOnce()
  })

  it('si el servidor rechaza por token vencido, renueva la sesion y reconecta', async () => {
    refreshSession.mockResolvedValue()
    renderHook(() => useRealtimeEvent('item:status_changed', vi.fn()))
    socket.active = false

    await fire('connect_error', new Error('UNAUTHENTICATED'))

    await waitFor(() => expect(socket.connect).toHaveBeenCalledOnce())
    expect(refreshSession).toHaveBeenCalledOnce()
  })

  it('mientras Socket.io sigue reintentando no fuerza una renovacion', async () => {
    renderHook(() => useRealtimeEvent('item:status_changed', vi.fn()))

    await fire('connect_error', new Error('xhr poll error'))

    expect(refreshSession).not.toHaveBeenCalled()
  })
})

describe('useRealtimeEvents (varios eventos, una conexion)', () => {
  it('abre un solo socket, entrega cada evento a su manejador y lo cierra al desmontar', async () => {
    const called = vi.fn()
    const created = vi.fn()
    const { unmount } = renderHook(() =>
      useRealtimeEvents({ 'waiter:called': called, 'qr_request:created': created }),
    )

    await fire('waiter:called', { serviceCallId: 'c1' })
    await fire('qr_request:created', { qrRequestId: 'q1' })

    expect(io).toHaveBeenCalledTimes(1)
    expect(called).toHaveBeenCalledWith({ serviceCallId: 'c1' })
    expect(created).toHaveBeenCalledWith({ qrRequestId: 'q1' })
    unmount()
    expect(socket.disconnect).toHaveBeenCalled()
  })

  it('llama onReconnect solo al reconectar y renueva el token si el servidor lo rechaza', async () => {
    const onReconnect = vi.fn()
    renderHook(() => useRealtimeEvents({ 'waiter:called': vi.fn() }, { onReconnect }))

    await fire('connect')
    expect(onReconnect).not.toHaveBeenCalled()
    await fire('connect')
    expect(onReconnect).toHaveBeenCalledTimes(1)

    socket.active = false
    refreshSession.mockResolvedValue()
    await fire('connect_error', new Error('jwt expired'))
    await waitFor(() => expect(socket.connect).toHaveBeenCalled())
  })

  it('sin token no abre conexion', () => {
    getAccessToken.mockReturnValue(null)
    renderHook(() => useRealtimeEvents({ 'waiter:called': vi.fn() }))
    expect(io).not.toHaveBeenCalled()
  })
})
