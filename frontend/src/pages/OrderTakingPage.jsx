import { ArrowLeft, ImageOff, Minus, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { getMenu } from '../api/menu.js'
import { createRound } from '../api/orders.js'
import { confirmQrRequest, listPendingQrRequests } from '../api/qrRequests.js'
import { useToast } from '../components/Toast.jsx'
import { useWaiterInbox } from '../hooks/useWaiterInbox.jsx'
import { WaiterPage } from '../layouts/WaiterLayout.jsx'
import { formatCOP } from '../utils/formatCOP.js'
import './OrderTakingPage.css'

function CategoryTabs({ categories, active, onChange }) {
  return (
    <div className="ot-categories" role="tablist" aria-label="Categorías">
      <button
        type="button"
        role="tab"
        aria-selected={active === null}
        className={`ot-cat-pill ${active === null ? 'ot-cat-pill--active' : ''}`}
        onClick={() => onChange(null)}
      >
        Todas
      </button>
      {categories.map((cat) => (
        <button
          key={cat.categoryId}
          type="button"
          role="tab"
          aria-selected={active === cat.categoryId}
          className={`ot-cat-pill ${active === cat.categoryId ? 'ot-cat-pill--active' : ''}`}
          onClick={() => onChange(cat.categoryId)}
        >
          {cat.name}
        </button>
      ))}
    </div>
  )
}

function ProductCard({ product, onAdd }) {
  return (
    <article className="ot-product">
      <div className="ot-product__thumb" aria-hidden="true">
        {product.photoUrl ? (
          <img src={product.photoUrl} alt="" className="ot-product__img" />
        ) : (
          <ImageOff size={24} className="ot-product__placeholder" />
        )}
      </div>
      <div className="ot-product__info">
        <span className="ot-product__name">{product.name}</span>
        <span className="ot-product__category">{product.categoryName}</span>
        <span className="ot-product__price">{formatCOP(product.price)}</span>
      </div>
      <button
        type="button"
        className="ot-product__add"
        onClick={() => onAdd(product)}
        aria-label={`Agregar ${product.name}`}
      >
        <Plus size={20} />
      </button>
    </article>
  )
}

function CartItem({ item, onQuantity, onRemove, onNote }) {
  const [showNote, setShowNote] = useState(false)

  return (
    <div className="ot-cart-item">
      <div className="ot-cart-item__header">
        <span className="ot-cart-item__name">{item.name}</span>
        <span className="ot-cart-item__price">{formatCOP(item.price * item.quantity)}</span>
      </div>
      {item.note && <span className="ot-cart-item__note">Nota: {item.note}</span>}
      <div className="ot-cart-item__controls">
        <div className="ot-qty">
          <button
            type="button"
            className="ot-qty__btn"
            onClick={() => onQuantity(item.productId, -1)}
            aria-label="Reducir cantidad"
          >
            <Minus size={14} />
          </button>
          <span className="ot-qty__value">{item.quantity}</span>
          <button
            type="button"
            className="ot-qty__btn"
            onClick={() => onQuantity(item.productId, 1)}
            aria-label="Aumentar cantidad"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="ot-cart-item__actions">
          <button
            type="button"
            className="ot-cart-item__note-btn"
            onClick={() => setShowNote(!showNote)}
            aria-label="Agregar nota"
          >
            {item.note ? 'Editar nota' : 'Nota'}
          </button>
          <button
            type="button"
            className="ot-cart-item__delete"
            onClick={() => onRemove(item.productId)}
            aria-label={`Eliminar ${item.name}`}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      {showNote && (
        <input
          type="text"
          className="ot-cart-item__note-input"
          placeholder="Ej: Sin crutones"
          maxLength={255}
          value={item.note || ''}
          onChange={(e) => onNote(item.productId, e.target.value)}
          autoFocus
        />
      )}
      <div className="ot-cart-item__divider" />
    </div>
  )
}

// GC-QR-0003. Con /mesero/solicitudes/:qrRequestId/ajustar la misma pantalla sirve para que el mesero ajuste
// una solicitud QR antes de confirmarla: el carrito arranca con lo que pidio el cliente y "Confirmar" llama
// a PUT /qr-requests/:id/confirm en vez de crear una ronda. Los precios los toma el backend (R3/R4).
function requestToCart(request, products) {
  const byId = new Map(products.map((p) => [p.productId, p]))
  const lines = []
  for (const item of request.items) {
    const product = byId.get(item.productId)
    const existing = lines.find((l) => l.productId === item.productId)
    if (existing) {
      // El carrito agrupa por producto: las notas de lineas repetidas se juntan
      existing.quantity += item.quantity
      existing.note = [existing.note, item.note].filter(Boolean).join(' · ')
    } else {
      lines.push({
        productId: item.productId,
        name: product?.name ?? 'Producto no disponible',
        price: product?.price ?? 0,
        quantity: item.quantity,
        note: item.note ?? '',
      })
    }
  }
  return lines
}

export default function OrderTakingPage() {
  const { orderId, qrRequestId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToast()
  const inbox = useWaiterInbox()
  const adjusting = Boolean(qrRequestId)
  const [request, setRequest] = useState(location.state?.request ?? null)
  const [requestGone, setRequestGone] = useState(false)

  const tableNumber = request?.tableNumber ?? location.state?.tableNumber ?? '—'

  const [menu, setMenu] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeCategory, setActiveCategory] = useState(null)
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState([])
  const [sending, setSending] = useState(false)

  const [menuError, setMenuError] = useState('')

  const fetchMenu = useCallback(
    () =>
      getMenu()
        .then(setMenu)
        .catch(() => setMenuError('No se pudo cargar el menú. Revisa la conexión e inténtalo de nuevo.'))
        .finally(() => setLoading(false)),
    [],
  )

  useEffect(() => {
    fetchMenu()
  }, [fetchMenu])

  // Al recargar la pagina no hay estado de navegacion: se busca la solicitud entre las pendientes
  useEffect(() => {
    if (!adjusting || request) return
    let active = true
    listPendingQrRequests()
      .then((list) => {
        if (!active) return
        const found = list.find((r) => r.qrRequestId === qrRequestId)
        if (found) setRequest(found)
        else setRequestGone(true)
      })
      .catch(() => active && setRequestGone(true))
    return () => {
      active = false
    }
  }, [adjusting, request, qrRequestId])

  // El carrito arranca con lo que pidio el cliente cuando ya hay menu (nombres y precios de referencia)
  const [seeded, setSeeded] = useState(false)
  if (adjusting && request && !seeded && !loading) {
    setSeeded(true)
    setCart(requestToCart(request, menu.flatMap((c) => c.products)))
  }

  const loadMenu = () => {
    setLoading(true)
    setMenuError('')
    fetchMenu()
  }

  const allProducts = useMemo(() => {
    return menu.flatMap((cat) =>
      cat.products.map((p) => ({ ...p, categoryName: cat.name, categoryId: cat.categoryId })),
    )
  }, [menu])

  const filtered = useMemo(() => {
    let list = allProducts
    if (activeCategory) list = list.filter((p) => p.categoryId === activeCategory)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((p) => p.name.toLowerCase().includes(q))
    }
    return list
  }, [allProducts, activeCategory, search])

  const addToCart = useCallback((product) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.productId === product.productId)
      if (existing) {
        return prev.map((i) =>
          i.productId === product.productId ? { ...i, quantity: i.quantity + 1 } : i,
        )
      }
      return [...prev, { productId: product.productId, name: product.name, price: product.price, quantity: 1, note: '' }]
    })
  }, [])

  const updateQuantity = useCallback((productId, delta) => {
    setCart((prev) => {
      return prev
        .map((i) => (i.productId === productId ? { ...i, quantity: i.quantity + delta } : i))
        .filter((i) => i.quantity > 0)
    })
  }, [])

  const removeItem = useCallback((productId) => {
    setCart((prev) => prev.filter((i) => i.productId !== productId))
  }, [])

  const updateNote = useCallback((productId, note) => {
    setCart((prev) =>
      prev.map((i) => (i.productId === productId ? { ...i, note } : i)),
    )
  }, [])

  const subtotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0)
  const itemCount = cart.reduce((sum, i) => sum + i.quantity, 0)

  const handleConfirm = async () => {
    if (cart.length === 0) return
    setSending(true)
    try {
      const items = cart.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        ...(i.note ? { note: i.note } : {}),
      }))
      if (adjusting) {
        const result = await confirmQrRequest(qrRequestId, items)
        const missing = result.unavailable?.map((u) => u.name).join(', ')
        toast.success(
          missing
            ? `Solicitud de la mesa ${tableNumber} confirmada. No disponibles: ${missing}`
            : `Solicitud de la mesa ${tableNumber} confirmada y enviada a cocina`,
        )
        // La bandeja vive en el layout: se quita aqui para que al volver ya no aparezca
        inbox.removeRequest(qrRequestId)
        navigate('/mesero/llamados', { replace: true })
        return
      }
      const result = await createRound(orderId, items)
      if (result.unavailable?.length) {
        const names = result.unavailable.map((u) => u.name).join(', ')
        toast.success(`Pedido enviado. No disponibles: ${names}`)
      } else {
        toast.success('Pedido enviado a cocina')
      }
      navigate(`/mesero/mesas/${orderId}`, { replace: true })
    } catch (err) {
      toast.error(err?.message || 'Error al enviar el pedido')
      // La solicitud ya se resolvio en otro dispositivo, ya no es de esta mesa o la mesa dejo de estar abierta
      if (adjusting && [403, 404, 409].includes(err?.status) && err?.code !== 'NO_AVAILABLE_ITEMS') {
        inbox.reload()
        navigate('/mesero/llamados', { replace: true })
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <WaiterPage
      title={
        <span className="ot-title">
          <button
            type="button"
            className="ot-back"
            onClick={() => navigate(-1)}
            aria-label="Volver"
          >
            <ArrowLeft size={20} />
          </button>
          {adjusting ? `Ajustar solicitud — Mesa ${tableNumber}` : `Toma de Pedido — Mesa ${tableNumber}`}
        </span>
      }
    >
      {requestGone && (
        <div className="ot-empty" role="alert">
          <p>Esta solicitud ya no está pendiente (se confirmó, se rechazó o la mesa cambió).</p>
          <button type="button" className="btn btn--ghost" onClick={() => navigate('/mesero/llamados')}>
            Volver a Llamados
          </button>
        </div>
      )}
      <div className="ot-layout" hidden={requestGone}>
        <div className="ot-catalog">
          <div className="ot-search">
            <Search size={18} className="ot-search__icon" />
            <input
              type="text"
              className="ot-search__input"
              placeholder="Buscar producto..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <CategoryTabs categories={menu} active={activeCategory} onChange={setActiveCategory} />

          {loading ? (
            <div className="ot-loading">Cargando menú…</div>
          ) : menuError ? (
            <div className="ot-empty" role="alert">
              <p>{menuError}</p>
              <button type="button" className="btn btn--ghost" onClick={loadMenu}>
                <RefreshCw size={16} /> Reintentar
              </button>
            </div>
          ) : (
            <div className="ot-products">
              {filtered.length === 0 ? (
                <p className="ot-empty">No se encontraron productos.</p>
              ) : (
                filtered.map((p) => (
                  <ProductCard key={p.productId} product={p} onAdd={addToCart} />
                ))
              )}
            </div>
          )}
        </div>

        <aside className="ot-cart" aria-label="Pedido actual">
          <div className="ot-cart__header">
            <h3 className="ot-cart__title">Pedido Actual</h3>
            {itemCount > 0 && <span className="ot-cart__badge">{itemCount}</span>}
          </div>
          <div className="ot-cart__divider" />

          <div className="ot-cart__items">
            {cart.length === 0 ? (
              <p className="ot-cart__empty">Agrega productos al pedido</p>
            ) : (
              cart.map((item) => (
                <CartItem
                  key={item.productId}
                  item={item}
                  onQuantity={updateQuantity}
                  onRemove={removeItem}
                  onNote={updateNote}
                />
              ))
            )}
          </div>

          <div className="ot-cart__footer">
            <div className="ot-cart__divider" />
            <div className="ot-cart__row">
              <span className="ot-cart__label">Subtotal:</span>
              <span className="ot-cart__value">{formatCOP(subtotal)}</span>
            </div>
            <div className="ot-cart__row ot-cart__row--total">
              <span className="ot-cart__total-label">Total:</span>
              <span className="ot-cart__total-value">{formatCOP(subtotal)}</span>
            </div>
            <button
              type="button"
              className="ot-cart__confirm"
              disabled={cart.length === 0 || sending}
              onClick={handleConfirm}
            >
              {sending ? 'Enviando…' : adjusting ? 'Confirmar solicitud' : 'Confirmar Pedido'}
            </button>
          </div>
        </aside>

        {/* Mobile sticky bar */}
        {cart.length > 0 && (
          <div className="ot-mobile-bar">
            <div className="ot-mobile-bar__info">
              <span className="ot-mobile-bar__count">{itemCount} ítem{itemCount > 1 ? 's' : ''}</span>
              <span className="ot-mobile-bar__total">{formatCOP(subtotal)}</span>
            </div>
            <button
              type="button"
              className="ot-mobile-bar__btn"
              disabled={sending}
              onClick={handleConfirm}
            >
              {sending ? 'Enviando…' : adjusting ? 'Confirmar' : 'Enviar Pedido'}
            </button>
          </div>
        )}
      </div>
    </WaiterPage>
  )
}
