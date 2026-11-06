import { ChevronLeft, ChevronRight, Plus, RefreshCw, TriangleAlert } from 'lucide-react'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { createShift, listEmployees, listShifts } from '../api/staff.js'
import { useToast } from '../components/Toast.jsx'
import { AdminPage } from '../layouts/AdminLayout.jsx'
import {
  STATUS_CLASS,
  STATUS_LABEL,
  addDays,
  dayKey,
  formatDayHeading,
  formatDuration,
  formatTime,
  formatWeekRange,
  mondayOf,
  todayKey,
  weekDays,
} from '../utils/shift.js'
import { ShiftFormModal } from './ShiftFormModal.jsx'
import './CatalogPages.css'
import './ShiftsPage.css'
import './UsersPage.css'

const byStart = (a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart)

function SkeletonRows() {
  return Array.from({ length: 4 }, (_, i) => (
    <tr key={i} className="users-table__skeleton" aria-hidden="true">
      <td colSpan={5}>
        <span />
      </td>
    </tr>
  ))
}

async function fetchData(week, userId) {
  try {
    const [employees, shifts] = await Promise.all([listEmployees(), listShifts({ week, userId })])
    return { status: 'ready', employees, shifts, error: '' }
  } catch (err) {
    return {
      status: 'error',
      employees: [],
      shifts: [],
      error:
        err.status === 403
          ? 'No tienes permiso para ver los turnos.'
          : 'No se pudo cargar la programación de turnos.',
    }
  }
}

export default function ShiftsPage() {
  const toast = useToast()
  const today = todayKey()
  const [week, setWeek] = useState(() => mondayOf(today))
  const [userId, setUserId] = useState('')
  const [{ status, employees, shifts, error }, setData] = useState({
    status: 'loading',
    employees: [],
    shifts: [],
    error: '',
  })
  // creating: false | { date? } (puede abrirse ya con el dia elegido)
  const [creating, setCreating] = useState(false)
  const [reload, setReload] = useState(0)

  // Carga al abrir y cada vez que cambia la semana, el filtro o se pide reintentar
  useEffect(() => {
    let active = true
    fetchData(week, userId).then((result) => active && setData(result))
    return () => {
      active = false
    }
  }, [week, userId, reload])

  const loading = () => setData((d) => ({ ...d, status: 'loading', error: '' }))
  const goToWeek = (monday) => {
    loading()
    setWeek(monday)
  }
  const changeUser = (event) => {
    loading()
    setUserId(event.target.value)
  }
  const retry = () => {
    loading()
    setReload((n) => n + 1)
  }

  const days = useMemo(() => weekDays(week), [week])
  const employeeById = useMemo(() => new Map(employees.map((e) => [e.userId, e])), [employees])
  const byDay = useMemo(() => {
    const groups = new Map(days.map((d) => [d, []]))
    shifts.forEach((s) => groups.get(dayKey(s.scheduledStart))?.push(s))
    return groups
  }, [days, shifts])

  const handleCreate = async (values) => {
    const created = await createShift(values)
    // Se agrega a la vista solo si cae en la semana (y el empleado) que se esta mirando
    const visible = days.includes(dayKey(created.scheduledStart)) && (!userId || created.userId === userId)
    if (visible) setData((d) => ({ ...d, shifts: [...d.shifts, created].sort(byStart) }))
    setCreating(false)
    toast.success(
      visible ? 'Turno programado' : `Turno programado (${formatDayHeading(dayKey(created.scheduledStart))})`,
    )
  }

  const noEmployees = status === 'ready' && employees.length === 0
  const isCurrentWeek = week === mondayOf(today)

  return (
    <AdminPage
      title="Gestión de Turnos"
      actions={
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => setCreating({})}
          disabled={status !== 'ready' || noEmployees}
          aria-label="Programar turno"
        >
          <Plus size={18} aria-hidden="true" />
          <span className="btn__text">Programar Turno</span>
        </button>
      }
    >
      <section className="shift-toolbar" aria-label="Semana y filtros">
        <div className="week-nav">
          <button
            type="button"
            className="icon-btn"
            onClick={() => goToWeek(addDays(week, -7))}
            aria-label="Semana anterior"
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <p className="week-nav__label" aria-live="polite">
            {formatWeekRange(week)}
          </p>
          <button
            type="button"
            className="icon-btn"
            onClick={() => goToWeek(addDays(week, 7))}
            aria-label="Semana siguiente"
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => goToWeek(mondayOf(today))}
            disabled={isCurrentWeek}
          >
            Hoy
          </button>
        </div>
        <select
          className="field__select shift-toolbar__filter"
          aria-label="Filtrar por empleado"
          value={userId}
          onChange={changeUser}
        >
          <option value="">Todos los empleados</option>
          {employees.map((e) => (
            <option key={e.userId} value={e.userId}>
              {e.fullName}
            </option>
          ))}
        </select>
      </section>

      <section className="users-card" aria-label="Turnos de la semana">
        {status === 'error' ? (
          <div className="users-state" role="alert">
            <TriangleAlert size={28} />
            <p>{error}</p>
            <button type="button" className="btn btn--ghost" onClick={retry}>
              <RefreshCw size={16} /> Reintentar
            </button>
          </div>
        ) : noEmployees ? (
          <div className="users-state">
            <p>
              Todavía no hay empleados. Registra primero su perfil en{' '}
              <Link to="/admin/empleados">Empleados</Link> para poder programarles turnos.
            </p>
          </div>
        ) : (
          <div className="users-table-wrap">
            <table className="users-table shifts-table">
              <thead>
                <tr>
                  <th scope="col">Empleado</th>
                  <th scope="col">Inicio</th>
                  <th scope="col">Fin</th>
                  <th scope="col" className="col-duration">
                    Duración
                  </th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {status === 'loading' ? (
                  <SkeletonRows />
                ) : (
                  days.map((day) => {
                    const dayShifts = byDay.get(day)
                    return (
                      <Fragment key={day}>
                        <tr className="day-row">
                          <th colSpan={5} scope="colgroup">
                            <div className="day-row__inner">
                              <span className="day-row__title">
                                {formatDayHeading(day)}
                                {day === today && <span className="day-row__today">Hoy</span>}
                              </span>
                              <button
                                type="button"
                                className="link-btn"
                                onClick={() => setCreating({ date: day })}
                                aria-label={`Programar turno el ${formatDayHeading(day)}`}
                              >
                                + Programar
                              </button>
                            </div>
                          </th>
                        </tr>
                        {dayShifts.length === 0 ? (
                          <tr className="day-empty">
                            <td colSpan={5}>Sin turnos</td>
                          </tr>
                        ) : (
                          dayShifts.map((s) => {
                            const employee = employeeById.get(s.userId)
                            return (
                              <tr key={s.shiftId}>
                                <td>
                                  <div className="user-cell__text">
                                    <span className="user-cell__name">
                                      {employee?.fullName ?? 'Empleado desconocido'}
                                    </span>
                                    {employee && <span className="employee-sub">{employee.position}</span>}
                                  </div>
                                </td>
                                <td>{formatTime(s.scheduledStart)}</td>
                                <td>{formatTime(s.scheduledEnd)}</td>
                                <td className="col-duration">
                                  {formatDuration(s.scheduledStart, s.scheduledEnd)}
                                </td>
                                <td>
                                  <span className={`pill ${STATUS_CLASS[s.status] ?? 'pill--done'}`}>
                                    {STATUS_LABEL[s.status] ?? s.status}
                                  </span>
                                </td>
                              </tr>
                            )
                          })
                        )}
                      </Fragment>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {creating && (
        <ShiftFormModal
          employees={employees}
          presetDate={creating.date}
          presetUserId={userId}
          onSubmit={handleCreate}
          onClose={() => setCreating(false)}
        />
      )}
    </AdminPage>
  )
}
