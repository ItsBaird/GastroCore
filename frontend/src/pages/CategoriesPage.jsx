import { Plus, RefreshCw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createCategory, listCategories, listProducts, updateCategory } from '../api/catalog.js'
import { useToast } from '../components/Toast.jsx'
import { AdminPage } from '../layouts/AdminLayout.jsx'
import { CategoryFormModal } from './CategoryFormModal.jsx'
import './CatalogPages.css'

// Franja de color de cada tarjeta (decorativa, como en el mockup)
const ACCENTS = ['red-600', 'orange-500', 'green-600', 'blue-600', 'purple-600', 'yellow-400']

const byOrder = (a, b) =>
  (a.displayOrder ?? Infinity) - (b.displayOrder ?? Infinity) || a.name.localeCompare(b.name, 'es')

function SkeletonCards() {
  return Array.from({ length: 6 }, (_, i) => (
    <div key={i} className="category-card category-card--skeleton" aria-hidden="true" />
  ))
}

export default function CategoriesPage() {
  const toast = useToast()
  const [{ status, categories, counts, error }, setData] = useState({
    status: 'loading',
    categories: [],
    counts: {},
    error: '',
  })
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const categories = await listCategories()
      // El conteo es informativo: si los productos no cargan, se muestran las categorias sin el
      const counts = {}
      try {
        ;(await listProducts()).forEach((p) => {
          counts[p.categoryId] = (counts[p.categoryId] ?? 0) + 1
        })
      } catch {
        counts.unavailable = true
      }
      return { status: 'ready', categories, counts, error: '' }
    } catch {
      return {
        status: 'error',
        categories: [],
        counts: {},
        error: 'No se pudo cargar la lista de categorías.',
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

  const sorted = useMemo(() => [...categories].sort(byOrder), [categories])

  const handleCreate = async (values) => {
    const created = await createCategory(values)
    setData((d) => ({ ...d, categories: [...d.categories, created] }))
    setCreating(false)
    toast.success('Categoría creada')
  }

  const handleEdit = async (values) => {
    const updated = await updateCategory(editing.categoryId, values)
    setData((d) => ({
      ...d,
      categories: d.categories.map((c) => (c.categoryId === updated.categoryId ? updated : c)),
    }))
    setEditing(null)
    toast.success('Cambios guardados')
  }

  return (
    <AdminPage
      title="Gestión de Categorías"
      actions={
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => setCreating(true)}
          aria-label="Nueva categoría"
        >
          <Plus size={18} aria-hidden="true" />
          <span className="btn__text">Nueva Categoría</span>
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
      ) : status === 'ready' && categories.length === 0 ? (
        <div className="catalog-state catalog-state--card">
          <p>Todavía no hay categorías. Crea la primera para poder agregar productos.</p>
        </div>
      ) : (
        <section className="category-grid" aria-label="Lista de categorías">
          {status === 'loading' ? (
            <SkeletonCards />
          ) : (
            sorted.map((c, i) => {
              const count = counts[c.categoryId] ?? 0
              return (
                <article
                  key={c.categoryId}
                  className="category-card"
                  style={{ '--accent-bar': `var(--${ACCENTS[i % ACCENTS.length]})` }}
                >
                  <h3 className="category-card__name">{c.name}</h3>
                  <p className="category-card__meta">
                    {counts.unavailable ? '' : `${count} ${count === 1 ? 'producto' : 'productos'}`}
                    {c.displayOrder != null && (
                      <span className="category-card__order">Orden {c.displayOrder}</span>
                    )}
                  </p>
                  <div className="category-card__actions">
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => setEditing(c)}
                      aria-label={`Editar categoría ${c.name}`}
                    >
                      Editar
                    </button>
                  </div>
                </article>
              )
            })
          )}
        </section>
      )}

      {creating && (
        <CategoryFormModal mode="create" onSubmit={handleCreate} onClose={() => setCreating(false)} />
      )}
      {editing && (
        <CategoryFormModal
          mode="edit"
          category={editing}
          onSubmit={handleEdit}
          onClose={() => setEditing(null)}
        />
      )}
    </AdminPage>
  )
}
