import { CircleDollarSign, CreditCard, Plus, RefreshCw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { createPaymentMethod, listPaymentMethods, updatePaymentMethod } from '../api/paymentMethods.js'
import { ConfirmDialog } from '../components/ConfirmDialog.jsx'
import { useToast } from '../components/Toast.jsx'
import { AdminPage } from '../layouts/AdminLayout.jsx'
import { PaymentMethodFormModal } from './PaymentMethodFormModal.jsx'
import './CatalogPages.css'
import './PaymentMethodsPage.css'
import './UsersPage.css'

// Color del icono de los metodos que no son efectivo (decorativo, como en el mockup)
const ACCENTS = ['blue', 'purple', 'orange', 'red']

const byName = (a, b) => a.name.localeCompare(b.name, 'es')

function SkeletonCards() {
  return Array.from({ length: 4 }, (_, i) => (
    <div key={i} className="pm-card pm-card--skeleton" aria-hidden="true" />
  ))
}

export default function PaymentMethodsPage() {
  const toast = useToast()
  const [{ status, methods, error }, setData] = useState({ status: 'loading', methods: [], error: '' })
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deactivating, setDeactivating] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const fetchMethods = useCallback(async () => {
    try {
      // Sin filtro: el admin ve tambien los inactivos (para poder reactivarlos)
      return { status: 'ready', methods: await listPaymentMethods(), error: '' }
    } catch (err) {
      return {
        status: 'error',
        methods: [],
        error:
          err.status === 403
            ? 'No tienes permiso para ver los métodos de pago.'
            : 'No se pudo cargar la lista de métodos de pago.',
      }
    }
  }, [])

  // Carga inicial (el estado ya arranca en "loading")
  useEffect(() => {
    let active = true
    fetchMethods().then((result) => active && setData(result))
    return () => {
      active = false
    }
  }, [fetchMethods])

  const retry = () => {
    setData((d) => ({ ...d, status: 'loading', error: '' }))
    fetchMethods().then(setData)
  }

  const sorted = [...methods].sort(byName)
  const replace = (updated) =>
    setData((d) => ({
      ...d,
      methods: d.methods.map((m) => (m.paymentMethodId === updated.paymentMethodId ? updated : m)),
    }))

  const handleCreate = async (values) => {
    const created = await createPaymentMethod(values)
    setData((d) => ({ ...d, methods: [...d.methods, created] }))
    setCreating(false)
    toast.success('Método de pago creado')
  }

  const handleEdit = async (changes) => {
    replace(await updatePaymentMethod(editing.paymentMethodId, changes))
    setEditing(null)
    toast.success('Cambios guardados')
  }

  // Activar y desactivar son el mismo PUT: el nombre es obligatorio, la bandera es lo que cambia
  async function setActive(method, isActive) {
    setBusyId(method.paymentMethodId)
    try {
      replace(await updatePaymentMethod(method.paymentMethodId, { name: method.name, isActive }))
      toast.success(isActive ? 'Método activado' : 'Método desactivado')
      setDeactivating(null)
    } catch {
      toast.error(isActive ? 'No se pudo activar el método' : 'No se pudo desactivar el método')
      setDeactivating(null)
    } finally {
      setBusyId(null)
    }
  }

  let nonCash = 0

  return (
    <AdminPage
      title="Métodos de Pago"
      actions={
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => setCreating(true)}
          aria-label="Nuevo método"
        >
          <Plus size={18} aria-hidden="true" />
          <span className="btn__text">Nuevo Método</span>
        </button>
      }
    >
      {status === 'error' ? (
        <div className="catalog-state catalog-state--card" role="alert">
          <TriangleAlert size={28} />
          <p>{error}</p>
          <button type="button" className="btn btn--ghost" onClick={retry}>
            <RefreshCw size={16} /> Reintentar
          </button>
        </div>
      ) : status === 'ready' && methods.length === 0 ? (
        <div className="catalog-state catalog-state--card">
          <p>Todavía no hay métodos de pago. Crea el primero para que el mesero pueda cobrar.</p>
        </div>
      ) : (
        <section className="pm-grid" aria-label="Lista de métodos de pago">
          {status === 'loading' ? (
            <SkeletonCards />
          ) : (
            sorted.map((m) => {
              const Icon = m.isCash ? CircleDollarSign : CreditCard
              const accent = m.isCash ? 'green' : ACCENTS[nonCash++ % ACCENTS.length]
              const busy = busyId === m.paymentMethodId
              return (
                <article key={m.paymentMethodId} className={`pm-card${m.isActive ? '' : ' pm-card--off'}`}>
                  <div className="pm-card__head">
                    <span className={`pm-card__icon pm-card__icon--${accent}`} aria-hidden="true">
                      <Icon size={22} />
                    </span>
                    <div className="pm-card__text">
                      <h3 className="pm-card__name">{m.name}</h3>
                      <p className="pm-card__kind">{m.isCash ? 'Efectivo en caja' : 'Pago electrónico'}</p>
                    </div>
                  </div>
                  <div className="pm-card__status">
                    <span className={`pill ${m.isActive ? 'pill--active' : 'pill--inactive'}`}>
                      {m.isActive ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                  <div className="pm-card__actions">
                    <button
                      type="button"
                      className="link-btn link-btn--blue"
                      onClick={() => setEditing(m)}
                      disabled={busy}
                      aria-label={`Editar método ${m.name}`}
                    >
                      Editar
                    </button>
                    {m.isActive ? (
                      <button
                        type="button"
                        className="link-btn link-btn--warn"
                        onClick={() => setDeactivating(m)}
                        disabled={busy}
                        aria-label={`Desactivar método ${m.name}`}
                      >
                        Desactivar
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="link-btn link-btn--success"
                        onClick={() => setActive(m, true)}
                        disabled={busy}
                        aria-label={`Activar método ${m.name}`}
                      >
                        Activar
                      </button>
                    )}
                  </div>
                </article>
              )
            })
          )}
        </section>
      )}

      {creating && (
        <PaymentMethodFormModal mode="create" onSubmit={handleCreate} onClose={() => setCreating(false)} />
      )}
      {editing && (
        <PaymentMethodFormModal
          mode="edit"
          method={editing}
          onSubmit={handleEdit}
          onClose={() => setEditing(null)}
        />
      )}
      {deactivating && (
        <ConfirmDialog
          title="Desactivar método de pago"
          message={`¿Desactivar «${deactivating.name}»? Dejará de aparecer al cobrar, pero se conserva en los registros históricos. Podrás activarlo de nuevo.`}
          confirmLabel="Desactivar"
          busy={busyId === deactivating.paymentMethodId}
          onConfirm={() => setActive(deactivating, false)}
          onCancel={() => setDeactivating(null)}
        />
      )}
    </AdminPage>
  )
}
