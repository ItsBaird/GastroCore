import { io } from 'socket.io-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectSocket, socketUrl } from './connectSocket.js'

vi.mock('socket.io-client', () => ({ io: vi.fn(() => ({ fake: true })) }))

const OPTIONS = { auth: () => {}, transports: ['websocket'] }

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('socketUrl (VITE_WS_URL)', () => {
  it('sin la variable (local) no hay URL: se usa el mismo origen, como siempre', () => {
    expect(socketUrl(undefined)).toBeUndefined()
    expect(socketUrl('')).toBeUndefined()
    expect(socketUrl('   ')).toBeUndefined()
  })

  it('con la URL de Orders en Render devuelve su origen', () => {
    expect(socketUrl('https://gastrocore-orders.onrender.com')).toBe('https://gastrocore-orders.onrender.com')
  })

  it('quita ruta y barra final: en Socket.io una ruta seria un namespace y no llegaria ningun evento', () => {
    expect(socketUrl('https://gastrocore-orders.onrender.com/')).toBe(
      'https://gastrocore-orders.onrender.com',
    )
    expect(socketUrl('https://gastrocore-orders.onrender.com/api/orders')).toBe(
      'https://gastrocore-orders.onrender.com',
    )
  })

  it('acepta http con puerto (pruebas locales contra Orders directo)', () => {
    expect(socketUrl('http://localhost:3004')).toBe('http://localhost:3004')
  })

  it.each(['orders.onrender.com', 'ws//mal', 'ftp://orders.onrender.com'])(
    'un valor invalido ("%s") avisa en consola y usa el mismo origen',
    (raw) => {
      expect(socketUrl(raw)).toBeUndefined()
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('VITE_WS_URL'))
    },
  )

  it('por defecto lee VITE_WS_URL del build', () => {
    vi.stubEnv('VITE_WS_URL', 'https://orders.example.com/x')
    expect(socketUrl()).toBe('https://orders.example.com')
  })
})

describe('connectSocket', () => {
  it('sin URL abre el socket al mismo origen con las opciones de siempre (igual que antes)', () => {
    connectSocket(OPTIONS, undefined)
    expect(io).toHaveBeenCalledWith(OPTIONS)
  })

  it('con URL abre el socket directo a Orders con las mismas opciones', () => {
    connectSocket(OPTIONS, 'https://gastrocore-orders.onrender.com')
    expect(io).toHaveBeenCalledWith('https://gastrocore-orders.onrender.com', OPTIONS)
  })

  it('devuelve el socket que crea socket.io-client', () => {
    expect(connectSocket(OPTIONS, undefined)).toEqual({ fake: true })
  })
})
