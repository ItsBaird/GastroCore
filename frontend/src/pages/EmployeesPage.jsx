import { Plus, RefreshCw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createEmployee, listEmployees, updateEmployee } from '../api/staff.js'
import { listUsers } from '../api/users.js'
import { useToast } from '../components/Toast.jsx'
import { AdminPage } from '../layouts/AdminLayout.jsx'
import { formatHireDate } from '../utils/employee.js'
import { roleLabel } from '../utils/user.js'
import { EmployeeFormModal } from './EmployeeFormModal.jsx'
import './CatalogPages.css'
import './EmployeesPage.css'
import './UsersPage.css'

const ROLE_CLASS = { ADMIN: 'pill--admin', WAITER: 'pill--waiter', COOK: 'pill--cook' }

const byName = (a, b) => a.fullName.localeCompare(b.fullName, 'es')

function SkeletonRows() {
  return Array.from({ length: 4 }, (_, i) => (
    <tr key={i} className="users-table__skeleton" aria-hidden="true">
      <td colSpan={6}>
        <span />
      </td>
    </tr>
  ))
}

export default function EmployeesPage() {
  const toast = useToast()
  const [{ status, employees, users, error }, setData] = useState({
    status: 'loading',
    employees: [],
    users: [],
    error: '',
  })
  // creating: false | { userId? } (puede abrirse ya con un usuario elegido)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const employees = await listEmployees()
      // Los usuarios dan el email/rol y permiten saber quien aun no tiene perfil. Si no cargan,
      // la lista de empleados se muestra igual.
      let users = []
      let usersOk = true
      try {
        users = await listUsers()
      } catch {
        usersOk = false
      }
      return { status: 'ready', employees, users, usersOk, error: '' }
    } catch (err) {
      return {
        status: 'error',
        employees: [],
        users: [],
        error:
          err.status === 403
            ? 'No tienes permiso para ver los empleados.'
            : 'No se pudo cargar la lista de empleados.',
      }
    }
  }, [])

  // Carga inicial (el estado ya arranca en "loading")
  useEffect(() => {
    let active = true
    fetchData().then((result) => active && setData(result))
    return () => {
      active = false
    }
  }, [fetchData])

  const retry = () => {
    setData((d) => ({ ...d, status: 'loading', error: '' }))
    fetchData().then(setData)
  }

  const sorted = useMemo(() => [...employees].sort(byName), [employees])
  const userById = useMemo(() => new Map(users.map((u) => [u.userId, u])), [users])
  const withoutProfile = useMemo(() => {
    const have = new Set(employees.map((e) => e.userId))
    return users.filter((u) => !have.has(u.userId)).sort((a, b) => a.email.localeCompare(b.email))
  }, [employees, users])

  const handleCreate = async (values) => {
    const created = await createEmployee(values)
    setData((d) => ({ ...d, employees: [...d.employees, created] }))
    setCreating(false)
    toast.success('Empleado registrado')
  }

  const handleEdit = async (changes) => {
    const updated = await updateEmployee(editing.userId, changes)
    setData((d) => ({
      ...d,
      employees: d.employees.map((e) => (e.userId === updated.userId ? updated : e)),
    }))
    setEditing(null)
    toast.success('Cambios guardados')
  }

  return (
    <AdminPage
      title="Gestión de Empleados"
      actions={
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => setCreating({})}
          aria-label="Agregar empleado"
        >
          <Plus size={18} aria-hidden="true" />
          <span className="btn__text">Agregar Empleado</span>
        </button>
      }
    >
      {status === 'ready' && withoutProfile.length > 0 && (
        <section className="pending" aria-label="Usuarios sin perfil laboral">
          <p className="pending__title">
            {withoutProfile.length === 1
              ? '1 usuario todavía no tiene perfil laboral'
              : `${withoutProfile.length} usuarios todavía no tienen perfil laboral`}
          </p>
          <ul className="pending__list">
            {withoutProfile.map((u) => (
              <li key={u.userId} className="pending__item">
                <span className="pending__email">{u.email}</span>
                <span className={`pill ${ROLE_CLASS[u.role]}`}>{u.role}</span>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => setCreating({ userId: u.userId })}
                  aria-label={`Completar perfil de ${u.email}`}
                >
                  Completar perfil
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="users-card" aria-label="Lista de empleados">
        {status === 'error' ? (
          <div className="users-state" role="alert">
            <TriangleAlert size={28} />
            <p>{error}</p>
            <button type="button" className="btn btn--ghost" onClick={retry}>
              <RefreshCw size={16} /> Reintentar
            </button>
          </div>
        ) : status === 'ready' && employees.length === 0 ? (
          <div className="users-state">
            <p>Todavía no hay empleados. Registra el perfil laboral de una cuenta de usuario.</p>
          </div>
        ) : (
          <div className="users-table-wrap">
            <table className="users-table employees-table">
              <thead>
                <tr>
                  <th scope="col">Empleado</th>
                  <th scope="col" className="col-doc">
                    Documento
                  </th>
                  <th scope="col">Cargo</th>
                  <th scope="col" className="col-phone">
                    Teléfono
                  </th>
                  <th scope="col">Ingreso</th>
                  <th scope="col">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {status === 'loading' ? (
                  <SkeletonRows />
                ) : (
                  sorted.map((e) => {
                    const owner = userById.get(e.userId)
                    return (
                      <tr key={e.userId}>
                        <td>
                          <div className="user-cell">
                            <span className="avatar">{e.fullName.charAt(0).toUpperCase()}</span>
                            <div className="user-cell__text">
                              <span className="user-cell__name">{e.fullName}</span>
                              {owner && (
                                <span className="employee-sub">
                                  {owner.email} · {roleLabel(owner.role)}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="users-table__email col-doc">{e.documentNumber}</td>
                        <td>{e.position}</td>
                        <td className="users-table__email col-phone">{e.phone ?? '—'}</td>
                        <td className="users-table__email">{formatHireDate(e.hireDate)}</td>
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="link-btn"
                              onClick={() => setEditing(e)}
                              aria-label={`Editar empleado ${e.fullName}`}
                            >
                              Editar
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {creating && (
        <EmployeeFormModal
          mode="create"
          users={withoutProfile}
          presetUserId={creating.userId}
          onSubmit={handleCreate}
          onClose={() => setCreating(false)}
        />
      )}
      {editing && (
        <EmployeeFormModal
          mode="edit"
          employee={editing}
          owner={userById.get(editing.userId)}
          onSubmit={handleEdit}
          onClose={() => setEditing(null)}
        />
      )}
    </AdminPage>
  )
}
