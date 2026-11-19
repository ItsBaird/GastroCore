import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/errors.js'
import * as staffApi from '../api/staff.js'
import { AuthContext } from '../auth/authContext.js'
import { ToastProvider } from '../components/Toast.jsx'
import { addDays, mondayOf, todayKey, toIso } from '../utils/shift.js'
import ShiftsPage from './ShiftsPage.jsx'

vi.mock('../api/staff.js')

const ME = { userId: 'me', email: 'admin@lapizzeta.co', role: 'ADMIN', isActive: true }
const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const EMPLOYEES = [
  { userId: U1, fullName: 'Carlos Rodríguez', position: 'Mesero' },
  { userId: U2, fullName: 'Ana Martínez', position: 'Cocinera' },
]

// La pantalla abre en la semana actual: los turnos de prueba se arman relativos a ella
const MONDAY = mondayOf(todayKey())
const TUESDAY = addDays(MONDAY, 1)
const shift = (id, userId, date, start, end, status = 'programado') => ({
  shiftId: id,
  userId,
  scheduledStart: new Date(toIso(date, start)).toISOString(),
  scheduledEnd: new Date(toIso(date, end)).toISOString(),
  actualStart: null,
  actualEnd: null,
  status,
})
const SHIFTS = [
  shift('s1', U1, MONDAY, '08:00', '16:00'),
  shift('s2', U2, MONDAY, '10:00', '14:30', 'activo'),
  shift('s3', U1, TUESDAY, '14:00', '20:00', 'finalizado'),
]

function renderPage() {
  const auth = { status: 'authenticated', user: ME, login: vi.fn(), logout: vi.fn() }
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <ShiftsPage />
        </ToastProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

// Selecciona empleado y escribe fecha y horas en el formulario abierto
async function fillForm(dialog, user, { employee, date, start, end }) {
  if (employee) await user.selectOptions(within(dialog).getByLabelText('Empleado'), employee)
  if (date) await user.type(within(dialog).getByLabelText('Fecha'), date)
  if (start) await user.type(within(dialog).getByLabelText('Hora de inicio'), start)
  if (end) await user.type(within(dialog).getByLabelText('Hora de fin'), end)
}

// El panel "Mi turno" de arriba tambien pide turnos (con el userId del admin): se le devuelve vacio para
// que estas pruebas solo hablen del horario. `fail` hace que el PRIMER pedido del horario falle.
function mockSchedule(list, fail) {
  let pending = fail
  staffApi.listShifts.mockImplementation(async ({ userId } = {}) => {
    if (userId === ME.userId) return []
    if (pending) {
      const err = pending
      pending = null
      throw err
    }
    return list
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  staffApi.listEmployees.mockResolvedValue(EMPLOYEES)
  mockSchedule(SHIFTS)
})

describe('ShiftsPage', () => {
  it('pide los turnos de la semana actual y los agrupa por día con empleado, horas, duración y estado', async () => {
    renderPage()
    await screen.findAllByText('Carlos Rodríguez')
    // El nombre también sale como opción del filtro: se cuenta solo dentro de la tabla
    expect(within(screen.getByRole('table')).getAllByText('Carlos Rodríguez')).toHaveLength(2)
    expect(staffApi.listShifts).toHaveBeenCalledWith({ week: MONDAY, userId: '' })
    // Una fila de encabezado por cada día de la semana
    expect(screen.getAllByRole('button', { name: /^Programar turno el / })).toHaveLength(7)
    expect(screen.getByText('Cocinera')).toBeInTheDocument()
    expect(screen.getByText('8:00 a. m.')).toBeInTheDocument()
    expect(screen.getByText('4:00 p. m.')).toBeInTheDocument()
    expect(screen.getByText('8h 00m')).toBeInTheDocument()
    expect(screen.getByText('4h 30m')).toBeInTheDocument()
    expect(screen.getByText('6h 00m')).toBeInTheDocument()
    expect(screen.getByText('Programado')).toBeInTheDocument()
    expect(screen.getByText('Activo')).toBeInTheDocument()
    expect(screen.getByText('Finalizado')).toBeInTheDocument()
    // Los 5 días restantes no tienen turnos
    expect(screen.getAllByText('Sin turnos')).toHaveLength(5)
  })

  it('navega a la semana siguiente y anterior, y "Hoy" vuelve a la actual', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByText('Carlos Rodríguez')
    expect(screen.getByRole('button', { name: 'Hoy' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Semana siguiente' }))
    await waitFor(() =>
      expect(staffApi.listShifts).toHaveBeenLastCalledWith({ week: addDays(MONDAY, 7), userId: '' }),
    )
    await user.click(screen.getByRole('button', { name: 'Semana siguiente' }))
    await user.click(screen.getByRole('button', { name: 'Semana anterior' }))
    await waitFor(() =>
      expect(staffApi.listShifts).toHaveBeenLastCalledWith({ week: addDays(MONDAY, 7), userId: '' }),
    )
    expect(screen.getByRole('button', { name: 'Hoy' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Hoy' }))
    await waitFor(() => expect(staffApi.listShifts).toHaveBeenLastCalledWith({ week: MONDAY, userId: '' }))
  })

  it('filtra por empleado', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByText('Carlos Rodríguez')
    await user.selectOptions(screen.getByLabelText('Filtrar por empleado'), U2)
    await waitFor(() => expect(staffApi.listShifts).toHaveBeenLastCalledWith({ week: MONDAY, userId: U2 }))
  })

  it('error al cargar -> alerta con reintento', async () => {
    mockSchedule(SHIFTS, new Error('x'))
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar la programación de turnos')
    await user.click(screen.getByRole('button', { name: /Reintentar/ }))
    expect(await screen.findAllByText('Carlos Rodríguez')).not.toHaveLength(0)
  })

  it('403 -> mensaje de permiso', async () => {
    mockSchedule(SHIFTS, new ApiError(403, 'FORBIDDEN', 'x'))
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes permiso')
  })

  it('sin empleados explica que hay que registrarlos primero y no deja programar', async () => {
    staffApi.listEmployees.mockResolvedValue([])
    mockSchedule([])
    renderPage()
    expect(await screen.findByText(/Todavía no hay empleados/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Empleados' })).toHaveAttribute('href', '/admin/empleados')
    expect(screen.getByRole('button', { name: 'Programar turno' })).toBeDisabled()
  })

  it('programa un turno: envía las horas con la zona de Colombia y lo muestra en su día', async () => {
    const user = userEvent.setup()
    staffApi.createShift.mockResolvedValue(shift('s9', U2, TUESDAY, '09:00', '13:00'))
    renderPage()
    await screen.findAllByText('Carlos Rodríguez')
    await user.click(screen.getByRole('button', { name: 'Programar turno' }))
    const dialog = screen.getByRole('dialog', { name: 'Programar turno' })
    await fillForm(dialog, user, { employee: U2, date: TUESDAY, start: '09:00', end: '13:00' })
    await user.click(within(dialog).getByRole('button', { name: 'Programar turno' }))
    await waitFor(() =>
      expect(staffApi.createShift).toHaveBeenCalledWith({
        userId: U2,
        scheduledStart: `${TUESDAY}T09:00:00-05:00`,
        scheduledEnd: `${TUESDAY}T13:00:00-05:00`,
      }),
    )
    expect(await screen.findByText('9:00 a. m.')).toBeInTheDocument()
    expect(screen.getByText('Turno programado')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('"+ Programar" de un día abre el formulario con esa fecha', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByText('Carlos Rodríguez')
    await user.click(screen.getAllByRole('button', { name: /^Programar turno el / })[1])
    const dialog = screen.getByRole('dialog', { name: 'Programar turno' })
    expect(within(dialog).getByLabelText('Fecha')).toHaveValue(TUESDAY)
  })

  it('con un empleado filtrado, el formulario lo trae elegido', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByText('Carlos Rodríguez')
    await user.selectOptions(screen.getByLabelText('Filtrar por empleado'), U2)
    await screen.findAllByText('Carlos Rodríguez')
    await user.click(screen.getByRole('button', { name: 'Programar turno' }))
    expect(within(screen.getByRole('dialog')).getByLabelText('Empleado')).toHaveValue(U2)
  })

  it('rango inválido (fin anterior o igual al inicio): avisa y no envía nada', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByText('Carlos Rodríguez')
    await user.click(screen.getByRole('button', { name: 'Programar turno' }))
    const dialog = screen.getByRole('dialog')
    await fillForm(dialog, user, { employee: U1, date: TUESDAY, start: '16:00', end: '08:00' })
    await user.click(within(dialog).getByRole('button', { name: 'Programar turno' }))
    expect(within(dialog).getByText(/El rango horario no es válido/)).toBeInTheDocument()
    expect(staffApi.createShift).not.toHaveBeenCalled()
  })

  it('valida los campos obligatorios', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByText('Carlos Rodríguez')
    await user.click(screen.getByRole('button', { name: 'Programar turno' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Programar turno' }))
    // La frase sale dos veces: la opción vacía del selector y el mensaje de error
    expect(within(dialog).getAllByText('Selecciona un empleado')).toHaveLength(2)
    expect(within(dialog).getByText('La fecha es obligatoria')).toBeInTheDocument()
    expect(within(dialog).getByText('La hora de inicio es obligatoria')).toBeInTheDocument()
    expect(within(dialog).getByText('La hora de fin es obligatoria')).toBeInTheDocument()
    expect(staffApi.createShift).not.toHaveBeenCalled()
  })

  it('si el servidor responde 400 por el rango, el mensaje sale en la hora de fin', async () => {
    const user = userEvent.setup()
    staffApi.createShift.mockRejectedValue(
      new ApiError(400, 'VALIDATION_ERROR', 'x', {
        fields: [{ path: 'scheduledEnd', message: 'El rango horario no es valido (servidor)' }],
      }),
    )
    renderPage()
    await screen.findAllByText('Carlos Rodríguez')
    await user.click(screen.getByRole('button', { name: 'Programar turno' }))
    const dialog = screen.getByRole('dialog')
    await fillForm(dialog, user, { employee: U1, date: TUESDAY, start: '08:00', end: '16:00' })
    await user.click(within(dialog).getByRole('button', { name: 'Programar turno' }))
    expect(await within(dialog).findByText('El rango horario no es valido (servidor)')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Programar turno' })).toBeEnabled()
  })

  it('un turno programado para otra semana no se mezcla con la vista y se avisa en qué día quedó', async () => {
    const user = userEvent.setup()
    const nextWeek = addDays(MONDAY, 8)
    staffApi.createShift.mockResolvedValue(shift('s9', U1, nextWeek, '08:00', '12:00'))
    renderPage()
    await screen.findAllByText('Carlos Rodríguez')
    await user.click(screen.getByRole('button', { name: 'Programar turno' }))
    const dialog = screen.getByRole('dialog')
    await fillForm(dialog, user, { employee: U1, date: nextWeek, start: '08:00', end: '12:00' })
    await user.click(within(dialog).getByRole('button', { name: 'Programar turno' }))
    expect(await screen.findByText(/Turno programado \(/)).toBeInTheDocument()
    expect(screen.queryByText('12:00 p. m.')).not.toBeInTheDocument()
  })
})

describe('ShiftsPage · iniciar/finalizar turnos', () => {
  // Esta tanda arranca con el admin con un turno activo propio y la agenda semanal de siempre
  const ADMIN_ACTIVE = {
    ...shift('mine', ME.userId, MONDAY, '08:00', '23:00', 'activo'),
    actualStart: new Date(Date.now() - 60 * 60_000).toISOString(),
  }
  beforeEach(() => {
    staffApi.listShifts.mockImplementation(async ({ userId } = {}) =>
      userId === ME.userId ? [ADMIN_ACTIVE] : SHIFTS,
    )
  })

  it('el admin ve arriba su propio turno si tiene uno activo hoy (como en el mockup)', async () => {
    renderPage()
    // El turno es de MONDAY: solo cuenta como "hoy" si hoy es lunes; un turno activo se muestra siempre
    expect(await screen.findByText('Turno activo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Finalizar turno' })).toBeInTheDocument()
  })

  it('cada turno activo de la agenda tiene su boton Finalizar; los demas no', async () => {
    renderPage()
    await screen.findAllByText('Carlos Rodríguez')
    expect(screen.getAllByRole('button', { name: /^Finalizar turno de / })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Finalizar turno de Ana Martínez' })).toBeInTheDocument()
  })

  it('el admin finaliza el turno de un empleado tras confirmar y se actualiza el estado', async () => {
    const user = userEvent.setup()
    staffApi.endShift.mockResolvedValue({ ...SHIFTS[1], status: 'finalizado' })
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Finalizar turno de Ana Martínez' }))
    const dialog = screen.getByRole('dialog', { name: 'Finalizar turno' })
    expect(within(dialog).getByText(/Ana Martínez/)).toBeInTheDocument()
    expect(staffApi.endShift).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Finalizar turno' }))
    expect(staffApi.endShift).toHaveBeenCalledWith('s2')
    expect(await screen.findByText('Turno finalizado')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Finalizar turno de Ana Martínez' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Finalizado')).toHaveLength(2)
  })

  it('si el empleado tiene mesas abiertas (HAS_OPEN_TABLES) avisa que hay que reasignarlas y no cambia nada', async () => {
    const user = userEvent.setup()
    staffApi.endShift.mockRejectedValue(new ApiError(409, 'HAS_OPEN_TABLES', 'x', { count: 2 }))
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Finalizar turno de Ana Martínez' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Finalizar turno' }))
    expect(
      await screen.findByText('El empleado tiene 2 mesas abiertas. Reasígnalas antes de finalizar su turno.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Finalizar turno de Ana Martínez' })).toBeInTheDocument()
  })

  it('cancelar la confirmacion no finaliza nada', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Finalizar turno de Ana Martínez' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }))
    expect(staffApi.endShift).not.toHaveBeenCalled()
  })
})
