import { LoaderCircle, Plus, RefreshCw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createUser, deactivateUser, listUsers, updateUser } from '../api/users.js'
import { useAuth } from '../auth/useAuth.js'
import { ConfirmDialog } from '../components/ConfirmDialog.jsx'
import { useToast } from '../components/Toast.jsx'
import { AdminPage } from '../layouts/AdminLayout.jsx'
import { countByRole, displayName, initial } from '../utils/user.js'
import { UserFormModal } from './UserFormModal.jsx'
import './UsersPage.css'

const ROLE_CLASS = { ADMIN: 'pill--admin', WAITER: 'pill--waiter', COOK: 'pill--cook' }

function StatCard({ label, value, tone }) {
  return (
    <div className="stat">
      <p className="stat__label">{label}</p>
      <p className={`stat__value stat__value--${tone}`}>{value}</p>
    </div>
  )
}

function SkeletonRows() {
  return Array.from({ length: 4 }, (_, i) => (
    <tr key={i} className="users-table__skeleton" aria-hidden="true">
      <td colSpan={5}>
        <span />
      </td>
    </tr>
  ))
}

export default function UsersPage() {
  const { user: me } = useAuth()
  const toast = useToast()
  const [{ status, users, error }, setData] = useState({ status: 'loading', users: [], error: '' })
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deactivating, setDeactivating] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const fetchUsers = useCallback(async () => {
    try {
      return { status: 'ready', users: await listUsers(), error: '' }
    } catch (err) {
      return {
        status: 'error',
        users: [],
        error:
          err.status === 403
            ? 'No tienes permiso para ver los usuarios.'
            : 'No se pudo cargar la lista de usuarios.',
      }
    }
  }, [])

  // Carga inicial (el estado ya arranca en "loading")
  useEffect(() => {
    let active = true
    fetchUsers().then((result) => active && setData(result))
    return () => {
      active = false
    }
  }, [fetchUsers])

  const retry = () => {
    setData((d) => ({ ...d, status: 'loading', error: '' }))
    fetchUsers().then(setData)
  }

  const counts = useMemo(() => countByRole(users), [users])
  const replaceUser = (updated) =>
    setData((d) => ({ ...d, users: d.users.map((u) => (u.userId === updated.userId ? updated : u)) }))

  const handleCreate = async (values) => {
    const created = await createUser(values)
    setData((d) => ({ ...d, users: [...d.users, created] }))
    setCreating(false)
    toast.success('Usuario creado')
  }

  const handleEdit = async (changes) => {
    const updated = await updateUser(editing.userId, changes)
    replaceUser(updated)
    setEditing(null)
    toast.success('Cambios guardados')
  }

  const handleDeactivate = async () => {
    const target = deactivating
    setBusyId(target.userId)
    try {
      await deactivateUser(target.userId)
      replaceUser({ ...target, isActive: false })
      toast.success('Usuario desactivado')
      setDeactivating(null)
    } catch {
      toast.error('No se pudo desactivar el usuario')
    } finally {
      setBusyId(null)
    }
  }

  const handleReactivate = async (target) => {
    setBusyId(target.userId)
    try {
      replaceUser(await updateUser(target.userId, { isActive: true }))
      toast.success('Usuario reactivado')
    } catch {
      toast.error('No se pudo reactivar el usuario')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <AdminPage
      title="Gestión de Usuarios"
      actions={
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => setCreating(true)}
          aria-label="Agregar usuario"
        >
          <Plus size={18} aria-hidden="true" />
          <span className="btn__text">Agregar Usuario</span>
        </button>
      }
    >
      <section className="stats" aria-label="Resumen de usuarios">
        <StatCard label="Total Usuarios" value={counts.total} tone="total" />
        <StatCard label="Administradores" value={counts.ADMIN} tone="admin" />
        <StatCard label="Meseros" value={counts.WAITER} tone="waiter" />
        <StatCard label="Cocineros" value={counts.COOK} tone="cook" />
      </section>

      <section className="users-card" aria-label="Lista de usuarios">
        {status === 'error' ? (
          <div className="users-state" role="alert">
            <TriangleAlert size={28} />
            <p>{error}</p>
            <button type="button" className="btn btn--ghost" onClick={retry}>
              <RefreshCw size={16} /> Reintentar
            </button>
          </div>
        ) : status === 'ready' && users.length === 0 ? (
          <div className="users-state">
            <p>Todavía no hay usuarios.</p>
          </div>
        ) : (
          <div className="users-table-wrap">
            <table className="users-table">
              <thead>
                <tr>
                  <th scope="col">Usuario</th>
                  <th scope="col" className="col-email">
                    Email
                  </th>
                  <th scope="col">Rol</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {status === 'loading' ? (
                  <SkeletonRows />
                ) : (
                  users.map((u) => {
                    const isSelf = u.userId === me.userId
                    const busy = busyId === u.userId
                    return (
                      <tr key={u.userId}>
                        <td>
                          <div className="user-cell">
                            <span className="avatar">{initial(u.email)}</span>
                            <div className="user-cell__text">
                              <span className="user-cell__name">
                                {displayName(u.email)}
                                {isSelf && <span className="user-cell__me">Tú</span>}
                              </span>
                              <span className="user-cell__sub">{u.email}</span>
                            </div>
                          </div>
                        </td>
                        <td className="users-table__email col-email">{u.email}</td>
                        <td>
                          <span className={`pill ${ROLE_CLASS[u.role]}`}>{u.role}</span>
                        </td>
                        <td>
                          <span className={`pill ${u.isActive ? 'pill--active' : 'pill--inactive'}`}>
                            {u.isActive ? 'Activo' : 'Inactivo'}
                          </span>
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="link-btn"
                              onClick={() => setEditing(u)}
                              disabled={isSelf || busy}
                              title={isSelf ? 'No puedes editar tu propia cuenta' : undefined}
                              aria-label={`Editar a ${displayName(u.email)}`}
                            >
                              Editar
                            </button>
                            {u.isActive ? (
                              <button
                                type="button"
                                className="link-btn link-btn--danger"
                                onClick={() => setDeactivating(u)}
                                disabled={isSelf || busy}
                                title={isSelf ? 'No puedes desactivar tu propia cuenta' : undefined}
                                aria-label={`Desactivar a ${displayName(u.email)}`}
                              >
                                Desactivar
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="link-btn link-btn--success"
                                onClick={() => handleReactivate(u)}
                                disabled={busy}
                                aria-label={`Reactivar a ${displayName(u.email)}`}
                              >
                                {busy ? <LoaderCircle className="spin" size={14} /> : 'Reactivar'}
                              </button>
                            )}
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

      {creating && <UserFormModal mode="create" onSubmit={handleCreate} onClose={() => setCreating(false)} />}
      {editing && (
        <UserFormModal
          mode="edit"
          user={editing}
          isSelf={editing.userId === me.userId}
          onSubmit={handleEdit}
          onClose={() => setEditing(null)}
        />
      )}
      {deactivating && (
        <ConfirmDialog
          title="Desactivar usuario"
          message={`¿Desactivar a ${displayName(deactivating.email)} (${deactivating.email})? No podrá iniciar sesión y se cerrarán sus sesiones abiertas. Podrás reactivarlo después.`}
          confirmLabel="Desactivar"
          busy={busyId === deactivating.userId}
          onConfirm={handleDeactivate}
          onCancel={() => setDeactivating(null)}
        />
      )}
    </AdminPage>
  )
}
