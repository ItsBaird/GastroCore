import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/errors.js'
import * as staffApi from '../api/staff.js'
import { AuthContext } from '../auth/authContext.js'
import { addDays, mondayOf, todayKey, toIso } from '../utils/shift.js'
import { MyShiftPanel } from './MyShiftPanel.jsx'
import { ToastProvider } from './Toast.jsx'

vi.mock('../api/staff.js')

const ME = { userId: 'me-1', email: 'carlos@lapizzeta.co', role: 'WAITER', isActive: true }
const TODAY = todayKey()

// Turno de hoy (el panel decide por el dia en hora de Colombia, igual que estos datos)
const shift = (overrides = {}) => ({
  shiftId: 's1',
  userId: ME.userId,
  scheduledStart: new Date(toIso(TODAY, '08:00')).toISOString(),
  scheduledEnd: new Date(toIso(TODAY, '23:59')).toISOString(),
  actualStart: null,
  actualEnd: null,
  status: 'programado',
  ...overrides,
})
const activeShift = (minutesAgo = 90) =>
  shift({ status: 'activo', actualStart: new Date(Date.now() - minutesAgo * 60_000).toISOString() })

function renderPanel(props) {
  const auth = { status: 'authenticated', user: ME, login: vi.fn(), logout: vi.fn() }
  return render(
    <AuthContext.Provider value={auth}>
      <ToastProvider>
        <MyShiftPanel {...props} />
      </ToastProvider>
    </AuthContext.Provider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  staffApi.listShifts.mockResolvedValue([shift()])
})

describe('MyShiftPanel · carga', () => {
  it('pide los turnos del propio usuario en la semana actual', async () => {
    renderPanel()
    await screen.findByText('Turno programado')
    expect(staffApi.listShifts).toHaveBeenCalledWith({ week: mondayOf(TODAY), userId: ME.userId })
  })

  it('turno programado de hoy: muestra el horario, la duracion y el boton Iniciar turno', async () => {
    renderPanel()
    expect(await screen.findByText('Turno programado')).toBeInTheDocument()
    expect(screen.getByText(/Hoy: 8:00 a\. m\. – 11:59 p\. m\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Iniciar turno' })).toBeEnabled()
  })

  it('error al cargar -> alerta con reintento', async () => {
    staffApi.listShifts.mockRejectedValueOnce(new Error('x'))
    const user = userEvent.setup()
    renderPanel()
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar tu turno')
    await user.click(screen.getByRole('button', { name: /Reintentar/ }))
    expect(await screen.findByText('Turno programado')).toBeInTheDocument()
  })

  it('sin turnos en la semana', async () => {
    staffApi.listShifts.mockResolvedValue([])
    renderPanel()
    expect(await screen.findByText('Sin turnos programados')).toBeInTheDocument()
  })

  it('hoy no hay turno pero si uno proximo: dice cuando es', async () => {
    const tomorrow = addDays(TODAY, 1)
    staffApi.listShifts.mockResolvedValue([
      shift({
        scheduledStart: new Date(toIso(tomorrow, '08:00')).toISOString(),
        scheduledEnd: new Date(toIso(tomorrow, '16:00')).toISOString(),
      }),
    ])
    renderPanel()
    expect(await screen.findByText('Hoy no tienes turno')).toBeInTheDocument()
    expect(screen.getByText(/Tu próximo turno: .*8:00 a\. m\. – 4:00 p\. m\./)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Iniciar turno' })).not.toBeInTheDocument()
  })

  it('turno ya finalizado hoy: resumen con inicio, fin y duracion', async () => {
    staffApi.listShifts.mockResolvedValue([
      shift({
        status: 'finalizado',
        actualStart: new Date(toIso(TODAY, '08:30')).toISOString(),
        actualEnd: new Date(toIso(TODAY, '16:10')).toISOString(),
      }),
    ])
    renderPanel()
    expect(await screen.findByText('Turno finalizado')).toBeInTheDocument()
    expect(
      screen.getByText(/Inicio: 8:30 a\. m\. — Fin: 4:10 p\. m\. — Duración: 7h 40m/),
    ).toBeInTheDocument()
  })

  it('con hideWhenEmpty no muestra nada si no hay turno que atender hoy', async () => {
    staffApi.listShifts.mockResolvedValue([])
    const { container } = renderPanel({ hideWhenEmpty: true })
    await waitFor(() => expect(staffApi.listShifts).toHaveBeenCalled())
    // (el contenedor de avisos del ToastProvider siempre esta: se mira solo lo del panel)
    await waitFor(() => expect(container.querySelector('.my-shift')).toBeNull())
  })

  it('con hideWhenEmpty tampoco muestra errores de carga ni un turno ya finalizado', async () => {
    staffApi.listShifts.mockRejectedValue(new Error('x'))
    const { container } = renderPanel({ hideWhenEmpty: true })
    await waitFor(() => expect(staffApi.listShifts).toHaveBeenCalled())
    await waitFor(() => expect(container.querySelector('.my-shift')).toBeNull())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('con hideWhenEmpty si hay un turno programado hoy lo muestra', async () => {
    renderPanel({ hideWhenEmpty: true })
    expect(await screen.findByRole('button', { name: 'Iniciar turno' })).toBeInTheDocument()
  })
})

describe('MyShiftPanel · iniciar turno', () => {
  it('inicio exitoso: pasa a "Turno activo" con la hora de inicio y el boton Finalizar', async () => {
    const user = userEvent.setup()
    staffApi.startShift.mockResolvedValue(activeShift(0))
    renderPanel()
    await user.click(await screen.findByRole('button', { name: 'Iniciar turno' }))
    expect(staffApi.startShift).toHaveBeenCalledWith('s1')
    expect(await screen.findByText('Turno activo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Finalizar turno' })).toBeInTheDocument()
    expect(screen.getByText('Turno iniciado')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Iniciar turno' })).not.toBeInTheDocument()
  })

  it('fuera de horario (antes): muestra cuando empieza el turno y NO lo activa', async () => {
    const user = userEvent.setup()
    staffApi.startShift.mockRejectedValue(
      new ApiError(409, 'INVALID_TRANSITION', 'x', {
        reason: 'BEFORE_START',
        scheduledStart: new Date(toIso(TODAY, '08:00')).toISOString(),
        scheduledEnd: new Date(toIso(TODAY, '16:00')).toISOString(),
      }),
    )
    renderPanel()
    await user.click(await screen.findByRole('button', { name: 'Iniciar turno' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Todavía no es la hora de tu turno. Empieza hoy a las 8:00 a. m.',
    )
    expect(screen.getByText('Turno programado')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Iniciar turno' })).toBeEnabled()
    expect(screen.queryByText('Turno activo')).not.toBeInTheDocument()
  })

  it('fuera de horario (despues): avisa que el turno ya termino', async () => {
    const user = userEvent.setup()
    staffApi.startShift.mockRejectedValue(
      new ApiError(409, 'INVALID_TRANSITION', 'x', {
        reason: 'AFTER_END',
        scheduledEnd: new Date(toIso(TODAY, '16:00')).toISOString(),
      }),
    )
    renderPanel()
    await user.click(await screen.findByRole('button', { name: 'Iniciar turno' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ya terminó (a las 4:00 p. m.)')
  })

  it('si el turno ya cambio de estado, avisa y vuelve a cargarlo', async () => {
    const user = userEvent.setup()
    staffApi.startShift.mockRejectedValue(new ApiError(409, 'INVALID_TRANSITION', 'x', { status: 'activo' }))
    renderPanel()
    await user.click(await screen.findByRole('button', { name: 'Iniciar turno' }))
    await waitFor(() => expect(staffApi.listShifts).toHaveBeenCalledTimes(2))
  })

  it('sin red -> mensaje y el boton sigue disponible', async () => {
    const user = userEvent.setup()
    staffApi.startShift.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'x'))
    renderPanel()
    await user.click(await screen.findByRole('button', { name: 'Iniciar turno' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo conectar con el servidor')
    expect(screen.getByRole('button', { name: 'Iniciar turno' })).toBeEnabled()
  })
})

describe('MyShiftPanel · finalizar turno', () => {
  beforeEach(() => staffApi.listShifts.mockResolvedValue([activeShift(272)]))

  it('turno activo: inicio, duracion y horario programado', async () => {
    renderPanel()
    expect(await screen.findByText('Turno activo')).toBeInTheDocument()
    expect(screen.getByText(/Duración: 4h 32m/)).toBeInTheDocument()
    expect(screen.getByText(/Programado: 8:00 a\. m\. – 11:59 p\. m\./)).toBeInTheDocument()
  })

  it('pide confirmacion y, sin mesas abiertas, finaliza (fin sin mesas)', async () => {
    const user = userEvent.setup()
    staffApi.endShift.mockResolvedValue(
      shift({
        status: 'finalizado',
        actualStart: new Date(Date.now() - 272 * 60_000).toISOString(),
        actualEnd: new Date().toISOString(),
      }),
    )
    renderPanel()
    await user.click(await screen.findByRole('button', { name: 'Finalizar turno' }))
    const dialog = screen.getByRole('dialog', { name: 'Finalizar turno' })
    expect(staffApi.endShift).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Finalizar turno' }))
    expect(staffApi.endShift).toHaveBeenCalledWith('s1')
    // El titulo de la tarjeta y el aviso emergente dicen lo mismo
    expect(await screen.findByText('Turno finalizado', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Turno finalizado')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('cancelar la confirmacion no finaliza nada', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(await screen.findByRole('button', { name: 'Finalizar turno' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }))
    expect(staffApi.endShift).not.toHaveBeenCalled()
    expect(screen.getByText('Turno activo')).toBeInTheDocument()
  })

  it('con mesas abiertas (HAS_OPEN_TABLES): explica que el administrador debe reasignarlas y sigue activo', async () => {
    const user = userEvent.setup()
    staffApi.endShift.mockRejectedValue(new ApiError(409, 'HAS_OPEN_TABLES', 'x', { count: 2 }))
    renderPanel()
    await user.click(await screen.findByRole('button', { name: 'Finalizar turno' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Finalizar turno' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tienes 2 mesas abiertas. El administrador debe reasignarlas antes de que puedas finalizar el turno.',
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Turno activo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Finalizar turno' })).toBeEnabled()
  })

  it('Orders no disponible (503) -> avisa y el turno sigue activo', async () => {
    const user = userEvent.setup()
    staffApi.endShift.mockRejectedValue(new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'x'))
    renderPanel()
    await user.click(await screen.findByRole('button', { name: 'Finalizar turno' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Finalizar turno' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo verificar las mesas abiertas')
    expect(screen.getByText('Turno activo')).toBeInTheDocument()
  })
})
