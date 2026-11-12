import {
  ClipboardList,
  ConciergeBell,
  LoaderCircle,
  Plus,
  QrCode,
  ReceiptText,
  RefreshCw,
  Search,
  ShoppingCart,
  Utensils,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { callWaiter, getPublicMenu } from '../api/qr.js'
import brandRing from '../assets/qr/brand-ring.svg'
import sliceDot from '../assets/qr/slice-dot.svg'
import slice from '../assets/qr/slice.svg'
import { useToast } from '../components/Toast.jsx'
import { useQrTable } from '../hooks/useQrTable.js'
import { formatCOP } from '../utils/formatCOP.js'
import './PublicMenuPage.css'
import './qr.tokens.css'

// GC-QR-0001. Vista publica del QR (Figma 69:2 "Cliente QR - Menu Publico", 390 px). Sin login: el estado
// y las capacidades los decide el backend (GET /qr/:token) y el menu viene de Catalog. Lo que el Figma no
// dibuja (mensaje por estado, "Pedir la cuenta", QR invalido, errores, carga, menu vacio, tablet y escritorio)
// es propuesta con los mismos tokens.

// Mensajes para el cliente: sin jerga interna (aprobados en la PARADA 0)
const STATUS_MESSAGE = {
  libre: () => 'Aún no hay un mesero asignado a tu mesa. Puedes ver el menú y llamar a un mesero.',
  ocupada: (n) => `Estás en la mesa ${n}. Puedes pedir o llamar a tu mesero.`,
  en_cobro: () => 'Tu mesa está en proceso de pago. Puedes ver el menú o llamar al mesero.',
}

// Busqueda sin tildes ni mayusculas: "cesar" encuentra "César"
const normalize = (text) =>
  (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

// El token viaja en la URL: se evita mandarlo como Referer (Oscar pone robots en index.html y vercel.json)
function useNoReferrer() {
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'referrer'
    meta.content = 'no-referrer'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [])
}

function usePublicMenu() {
  const [state, setState] = useState({ phase: 'loading', categories: [] })

  const load = useCallback((signal) => {
    getPublicMenu({ signal })
      .then((categories) => setState({ phase: 'ready', categories: categories ?? [] }))
      .catch(() => {
        if (!signal?.aborted) setState({ phase: 'error', categories: [] })
      })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  const retry = () => {
    setState({ phase: 'loading', categories: [] })
    load()
  }
  return { ...state, retry }
}

function SlicePlaceholder() {
  return (
    <span className="qr-photo__placeholder" aria-hidden="true">
      <span className="qr-slice">
        <img className="qr-slice__body" src={slice} alt="" width="31" height="27" />
        <img className="qr-slice__dot qr-slice__dot--a" src={sliceDot} alt="" width="5" height="5" />
        <img className="qr-slice__dot qr-slice__dot--b" src={sliceDot} alt="" width="5" height="5" />
      </span>
    </span>
  )
}

function ProductPhoto({ product, eager }) {
  const [failed, setFailed] = useState(false)
  if (!product.photoUrl || failed) return <SlicePlaceholder />
  return (
    <img
      className="qr-photo__img"
      src={product.photoUrl}
      alt={product.name}
      width="171"
      height="96"
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}

function ProductCard({ product, canOrder, eager }) {
  return (
    <li className="qr-card">
      <div className="qr-photo">
        <ProductPhoto product={product} eager={eager} />
      </div>
      <h3 className="qr-card__name">{product.name}</h3>
      {product.description && <p className="qr-card__desc">{product.description}</p>}
      <div className="qr-card__foot">
        <span className="qr-card__price">{formatCOP(product.price)}</span>
        {canOrder && (
          // Punto de entrada de la solicitud de pedido (GC-QR-0003): aun sin pantalla
          <button
            type="button"
            className="qr-card__add"
            disabled
            aria-label={`Agregar ${product.name} (próximamente)`}
            title="Próximamente"
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  )
}

function FullState({ icon: Icon, title, text, action }) {
  return (
    <div className="qr-full" role="alert">
      <Icon size={32} aria-hidden="true" />
      <h1 className="qr-full__title">{title}</h1>
      {text && <p className="qr-full__text">{text}</p>}
      {action}
    </div>
  )
}

// QR invalido: token inexistente, mesa eliminada o una ruta /m/... incompleta
export function InvalidQrPage() {
  return (
    <main className="qr-page qr-page--state">
      <FullState icon={QrCode} title="Este código QR no es válido" text="Pide ayuda a un mesero." />
    </main>
  )
}

function errorText(err) {
  if (err?.status === 429) return 'Hay muchas consultas en este momento. Espera unos segundos e intenta de nuevo.'
  if (err?.status === 0) return 'Revisa tu conexión a internet e intenta de nuevo.'
  return 'No pudimos cargar la información de tu mesa. Intenta de nuevo.'
}

export default function PublicMenuPage() {
  const { qrToken } = useParams()
  const toast = useToast()
  const qr = useQrTable(qrToken)
  const menu = usePublicMenu()
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState(null)
  const [calling, setCalling] = useState(false)
  useNoReferrer()

  // Solo categorias con productos
  const categories = useMemo(
    () => menu.categories.filter((c) => c.products?.length > 0),
    [menu.categories],
  )

  const visible = useMemo(() => {
    const q = normalize(query.trim())
    return categories
      .filter((c) => !categoryId || c.categoryId === categoryId)
      .map((c) => ({
        ...c,
        products: q
          ? c.products.filter((p) => normalize(`${p.name} ${p.description ?? ''}`).includes(q))
          : c.products,
      }))
      .filter((c) => c.products.length > 0)
  }, [categories, categoryId, query])

  const handleCall = async () => {
    setCalling(true)
    try {
      await callWaiter(qrToken)
      toast.success('Listo, avisamos al mesero. En un momento te atiende.')
    } catch (err) {
      if (err?.status === 409 && err.code === 'CONFLICT') {
        toast.success('Ya avisamos al mesero. En un momento te atiende.')
      } else if (err?.status === 404) {
        qr.retry()
      } else {
        toast.error(
          err?.status === 429
            ? 'Espera unos segundos antes de volver a llamar.'
            : 'No pudimos avisar al mesero. Intenta de nuevo.',
        )
      }
    } finally {
      setCalling(false)
    }
  }

  if (qr.phase === 'invalid') return <InvalidQrPage />

  if (qr.phase === 'error') {
    return (
      <main className="qr-page qr-page--state">
        <FullState
          icon={RefreshCw}
          title="No pudimos cargar tu mesa"
          text={errorText(qr.error)}
          action={
            <button type="button" className="qr-btn-outline" onClick={qr.retry}>
              <RefreshCw size={16} aria-hidden="true" /> Reintentar
            </button>
          }
        />
      </main>
    )
  }

  const table = qr.table
  const caps = table?.capabilities
  // Las dos primeras fotos visibles cargan de inmediato; el resto, perezosas
  const eagerIds = new Set(visible.flatMap((c) => c.products).slice(0, 2).map((p) => p.productId))

  return (
    <div className="qr-page">
      <header className="qr-header">
        <div className="qr-shell qr-header__row">
          <img className="qr-brand__logo" src={brandRing} alt="" width="20" height="20" />
          <h1 className="qr-brand__name">La Pizzeta</h1>
          {table && <span className="qr-table-pill">Mesa {table.tableNumber}</span>}
        </div>
      </header>

      <main className="qr-shell qr-main" aria-busy={qr.phase === 'loading'}>
        <p className="qr-status" aria-live="polite">
          {table ? (
            <>
              <span className={`qr-status__dot qr-status__dot--${table.status}`} aria-hidden="true" />
              {(STATUS_MESSAGE[table.status] ?? STATUS_MESSAGE.libre)(table.tableNumber)}
            </>
          ) : (
            'Cargando tu mesa…'
          )}
        </p>

        <label className="qr-search">
          <Search size={14} aria-hidden="true" />
          <span className="sr-only">Buscar en el menú</span>
          <input
            type="search"
            placeholder="Buscar en el menú..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            enterKeyHint="search"
            autoComplete="off"
          />
        </label>

        {categories.length > 0 && (
          <nav className="qr-chips" aria-label="Categorías">
            <button
              type="button"
              className={`qr-chip${categoryId === null ? ' qr-chip--active' : ''}`}
              aria-pressed={categoryId === null}
              onClick={() => setCategoryId(null)}
            >
              Todas
            </button>
            {categories.map((c) => (
              <button
                key={c.categoryId}
                type="button"
                className={`qr-chip${categoryId === c.categoryId ? ' qr-chip--active' : ''}`}
                aria-pressed={categoryId === c.categoryId}
                onClick={() => setCategoryId(c.categoryId)}
              >
                {c.name}
              </button>
            ))}
          </nav>
        )}

        {menu.phase === 'loading' && (
          <ul className="qr-grid" aria-label="Cargando el menú">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="qr-card qr-card--skeleton" aria-hidden="true" />
            ))}
          </ul>
        )}

        {menu.phase === 'error' && (
          <div className="qr-inline-state" role="alert">
            <p>No pudimos cargar el menú.</p>
            <button type="button" className="qr-btn-outline" onClick={menu.retry}>
              <RefreshCw size={16} aria-hidden="true" /> Reintentar
            </button>
          </div>
        )}

        {menu.phase === 'ready' && categories.length === 0 && (
          <p className="qr-inline-state">Por ahora no hay productos disponibles.</p>
        )}

        {menu.phase === 'ready' && categories.length > 0 && visible.length === 0 && (
          <p className="qr-inline-state">No encontramos productos con “{query.trim()}”.</p>
        )}

        {visible.map((c) => (
          <section key={c.categoryId} className="qr-section" aria-labelledby={`cat-${c.categoryId}`}>
            <h2 id={`cat-${c.categoryId}`} className="qr-section__title">
              {c.name}
            </h2>
            <ul className="qr-grid">
              {c.products.map((p) => (
                <ProductCard
                  key={p.productId}
                  product={p}
                  canOrder={Boolean(caps?.sendRequest)}
                  eager={eagerIds.has(p.productId)}
                />
              ))}
            </ul>
          </section>
        ))}
      </main>

      <div className="qr-dock">
        {caps && (caps.callWaiter || caps.requestBill) && (
          <div className="qr-shell qr-actions">
            {caps.callWaiter && (
              <button
                type="button"
                className="qr-btn-call"
                onClick={handleCall}
                disabled={calling}
              >
                {calling ? (
                  <LoaderCircle className="spin" size={18} aria-hidden="true" />
                ) : (
                  <ConciergeBell size={18} aria-hidden="true" />
                )}
                Llamar al mesero
              </button>
            )}
            {caps.requestBill && (
              // GC-QR-0004: aun sin backend
              <button type="button" className="qr-btn-bill" disabled title="Próximamente">
                <ReceiptText size={18} aria-hidden="true" />
                Pedir la cuenta
                <span className="qr-soon">Próximamente</span>
              </button>
            )}
          </div>
        )}

        <nav className="qr-tabs" aria-label="Secciones">
          <div className="qr-shell qr-tabs__row">
            <span className="qr-tab qr-tab--active" aria-current="page">
              <Utensils size={22} aria-hidden="true" />
              Menú
            </span>
            {/* Mi Pedido y Estado son de GC-QR-0003: se ven como en el Figma, aun deshabilitados */}
            <button type="button" className="qr-tab" disabled title="Próximamente">
              <ShoppingCart size={22} aria-hidden="true" />
              Mi Pedido
              <span className="sr-only">(próximamente)</span>
            </button>
            <button type="button" className="qr-tab" disabled title="Próximamente">
              <ClipboardList size={22} aria-hidden="true" />
              Estado
              <span className="sr-only">(próximamente)</span>
            </button>
          </div>
        </nav>
      </div>
    </div>
  )
}
