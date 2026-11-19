import { Plus, RefreshCw, TriangleAlert, UtensilsCrossed } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createProduct,
  listCategories,
  listProducts,
  setProductAvailability,
  updateProduct,
} from '../api/catalog.js'
import { useToast } from '../components/Toast.jsx'
import { AdminPage } from '../layouts/AdminLayout.jsx'
import { formatCop } from '../utils/catalog.js'
import { ProductFormModal } from './ProductFormModal.jsx'
import './CatalogPages.css'

function SkeletonRows() {
  return Array.from({ length: 5 }, (_, i) => (
    <tr key={i} className="catalog-table__skeleton" aria-hidden="true">
      <td colSpan={5}>
        <span />
      </td>
    </tr>
  ))
}

function Thumb({ src }) {
  const [broken, setBroken] = useState(false)
  return (
    <span className="product-thumb">
      {src && !broken ? (
        <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <UtensilsCrossed size={20} aria-hidden="true" />
      )}
    </span>
  )
}

export default function ProductsPage() {
  const toast = useToast()
  const [{ status, products, categories, error }, setData] = useState({
    status: 'loading',
    products: [],
    categories: [],
    error: '',
  })
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')

  const fetchData = useCallback(async () => {
    try {
      const [products, categories] = await Promise.all([listProducts(), listCategories()])
      return { status: 'ready', products, categories, error: '' }
    } catch {
      return {
        status: 'error',
        products: [],
        categories: [],
        error: 'No se pudo cargar la lista de productos.',
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

  const categoryName = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.categoryId, c.name])),
    [categories],
  )

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return products.filter(
      (p) =>
        (!categoryFilter || p.categoryId === categoryFilter) &&
        (!term || p.name.toLowerCase().includes(term)),
    )
  }, [products, search, categoryFilter])

  const replaceProduct = (updated) =>
    setData((d) => ({
      ...d,
      products: d.products.map((p) => (p.productId === updated.productId ? updated : p)),
    }))

  const handleCreate = async (form) => {
    const created = await createProduct(form)
    setData((d) => ({
      ...d,
      products: [...d.products, created].sort((a, b) => a.name.localeCompare(b.name, 'es')),
    }))
    setCreating(false)
    toast.success('Producto creado')
  }

  const handleEdit = async (form) => {
    replaceProduct(await updateProduct(editing.productId, form))
    setEditing(null)
    toast.success('Cambios guardados')
  }

  const toggleAvailability = async (product) => {
    setBusyId(product.productId)
    try {
      replaceProduct(await setProductAvailability(product.productId, !product.isAvailable))
      toast.success(product.isAvailable ? 'Producto marcado como agotado' : 'Producto disponible')
    } catch {
      toast.error('No se pudo cambiar la disponibilidad')
    } finally {
      setBusyId(null)
    }
  }

  const noCategories = status === 'ready' && categories.length === 0

  return (
    <AdminPage
      title="Gestión de Productos"
      actions={
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => setCreating(true)}
          disabled={status !== 'ready' || noCategories}
          title={noCategories ? 'Crea una categoría primero' : undefined}
          aria-label="Agregar producto"
        >
          <Plus size={18} aria-hidden="true" />
          <span className="btn__text">Agregar Producto</span>
        </button>
      }
    >
      <section className="catalog-filters" aria-label="Filtros">
        <input
          type="search"
          className="field__input"
          placeholder="Buscar producto..."
          aria-label="Buscar producto"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="field__select"
          aria-label="Filtrar por categoría"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="">Todas las categorías</option>
          {categories.map((c) => (
            <option key={c.categoryId} value={c.categoryId}>
              {c.name}
            </option>
          ))}
        </select>
      </section>

      <section className="catalog-card" aria-label="Lista de productos">
        {status === 'error' ? (
          <div className="catalog-state" role="alert">
            <TriangleAlert size={28} />
            <p>{error}</p>
            <button type="button" className="btn btn--ghost" onClick={retry}>
              <RefreshCw size={16} /> Reintentar
            </button>
          </div>
        ) : noCategories ? (
          <div className="catalog-state">
            <p>Primero crea una categoría en la sección Categorías para poder agregar productos.</p>
          </div>
        ) : status === 'ready' && products.length === 0 ? (
          <div className="catalog-state">
            <p>Todavía no hay productos.</p>
          </div>
        ) : status === 'ready' && visible.length === 0 ? (
          <div className="catalog-state">
            <p>Ningún producto coincide con la búsqueda.</p>
          </div>
        ) : (
          <div className="catalog-table-wrap">
            <table className="catalog-table">
              <thead>
                <tr>
                  <th scope="col">Producto</th>
                  <th scope="col" className="col-category">
                    Categoría
                  </th>
                  <th scope="col">Precio</th>
                  <th scope="col">Disponible</th>
                  <th scope="col">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {status === 'loading' ? (
                  <SkeletonRows />
                ) : (
                  visible.map((p) => (
                    <tr key={p.productId}>
                      <td>
                        <div className="product-cell">
                          <Thumb src={p.photoUrl} />
                          <div className="product-cell__text">
                            <span className="product-cell__name">{p.name}</span>
                            {p.description && <span className="product-cell__desc">{p.description}</span>}
                            <span className="product-cell__cat">{categoryName[p.categoryId]}</span>
                          </div>
                        </div>
                      </td>
                      <td className="col-category catalog-table__muted">{categoryName[p.categoryId]}</td>
                      <td className="catalog-table__price">{formatCop(p.price)}</td>
                      <td>
                        <button
                          type="button"
                          className={`pill pill--toggle ${p.isAvailable ? 'pill--active' : 'pill--inactive'}`}
                          onClick={() => toggleAvailability(p)}
                          disabled={busyId === p.productId}
                          aria-label={
                            p.isAvailable
                              ? `${p.name}: disponible. Marcar como agotado`
                              : `${p.name}: agotado. Marcar como disponible`
                          }
                        >
                          {p.isAvailable ? 'Disponible' : 'Agotado'}
                        </button>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => setEditing(p)}
                          aria-label={`Editar ${p.name}`}
                        >
                          Editar
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {creating && (
        <ProductFormModal
          mode="create"
          categories={categories}
          onSubmit={handleCreate}
          onClose={() => setCreating(false)}
        />
      )}
      {editing && (
        <ProductFormModal
          mode="edit"
          product={editing}
          categories={categories}
          onSubmit={handleEdit}
          onClose={() => setEditing(null)}
        />
      )}
    </AdminPage>
  )
}
