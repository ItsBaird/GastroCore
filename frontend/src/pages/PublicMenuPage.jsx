import {
  BellRing,
  CircleCheck,
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
import { getPublicMenu, sendOrderRequest } from '../api/qr.js'
import brandRing from '../assets/qr/brand-ring.svg'
import sliceDot from '../assets/qr/slice-dot.svg'
import slice from '../assets/qr/slice.svg'
import { useCallWaiter } from '../hooks/useCallWaiter.js'
import { useOrderCart } from '../hooks/useOrderCart.js'
import { useQrTable } from '../hooks/useQrTable.js'
import { formatCOP } from '../utils/formatCOP.js'
import './PublicMenuPage.css'
import './qr.tokens.css'
import { QrOrderSheet } from './QrOrderSheet.jsx'
import { QrProductSheet } from './QrProductSheet.jsx'

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

// GC-QR-0002. Lo que muestra el boton en cada estado de useCallWaiter. Un 409 (ya habia llamado) se dice
// como informacion, no como error.
const CALL_VIEW = {
  idle: { label: 'Llamar al mesero', icon: ConciergeBell, disabled: false, message: '' },
  sending: { label: 'Avisando…', icon: LoaderCircle, disabled: true, message: '' },
  sent: {
    label: 'Mesero avisado',
    icon: CircleCheck,
    disabled: true,
    message: 'Avisamos al mesero. En un momento se acercará.',
    tone: 'ok',
  },
  already: {
    label: 'Mesero avisado',
    icon: BellRing,
    disabled: true,
    message: 'Ya avisamos al mesero, no hace falta volver a llamar.',
    tone: 'info',
  },
  limited: {
    label: 'Llamar al mesero',
    icon: ConciergeBell,
    disabled: false,
    message: 'Espera unos segundos e intenta de nuevo.',
    tone: 'warn',
  },
  failed: {
    label: 'Reintentar llamado',
    icon: RefreshCw,
    disabled: false,
    message: 'No pudimos avisar al mesero. Revisa tu conexión e intenta de nuevo.',
    tone: 'warn',
  },
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

function ProductCard({ product, canOrder, eager, onOpen }) {
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
          // GC-QR-0003: abre el detalle (70:2) para elegir cantidad y nota
          <button
            type="button"
            className="qr-card__add"
            onClick={() => onOpen(product)}
            aria-label={`Agregar ${product.name}`}
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
  const qr = useQrTable(qrToken)
  const menu = usePublicMenu()
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState(null)
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

  const waiterCall = useCallWaiter(qrToken, { onInvalid: qr.retry })

  // GC-QR-0003: detalle, carrito "Mi Pedido" y envio
  const cart = useOrderCart()
  const [detail, setDetail] = useState(null)
  const [orderOpen, setOrderOpen] = useState(false)
  const [orderPhase, setOrderPhase] = useState('editing') // editing | sending | sent
  const [orderError, setOrderError] = useState('')
  const [sentLines, setSentLines] = useState([])
  const [failedByNetwork, setFailedByNetwork] = useState(false)

  const openOrder = () => {
    setOrderPhase('editing')
    setOrderOpen(true)
  }

  let blockedReason = ''
  if (qr.table && !qr.table.capabilities?.sendRequest) {
    blockedReason =
      qr.table.status === 'en_cobro'
        ? 'Tu mesa ya está en proceso de pago; no se aceptan más pedidos.'
        : 'Tu mesa no tiene un mesero asignado; llama a un mesero para hacer tu pedido.'
  }

  const handleSend = async () => {
    const lines = cart.lines
    setOrderPhase('sending')
    setOrderError('')
    try {
      await sendOrderRequest(qrToken, lines)
      setSentLines(lines)
      cart.clear()
      setFailedByNetwork(false)
      setOrderPhase('sent')
    } catch (err) {
      setOrderPhase('editing')
      const fields = err?.details?.fields
      const unavailable = err?.details?.unavailable
      if (err?.status === 400 && Array.isArray(fields)) {
        // details.fields: [{ path: 'items.N.campo', message }] -> se marca la linea N que se envio
        const problems = {}
        for (const field of fields) {
          const match = /^items\.(\d+)\.(\w+)/.exec(field.path ?? '')
          const line = match && lines[Number(match[1])]
          if (line) {
            problems[line.key] =
              match[2] === 'productId'
                ? 'Este producto ya no está disponible. Quítalo para enviar.'
                : field.message
          }
        }
        cart.markProblems(problems)
        if (Object.keys(problems).length === 0) setOrderError('Revisa tu pedido e intenta de nuevo.')
      } else if (err?.status === 409 && Array.isArray(unavailable)) {
        const ids = new Set(unavailable.map((u) => u.productId))
        const problems = {}
        for (const line of lines) {
          if (ids.has(line.productId)) problems[line.key] = 'Se agotó. Quítalo para enviar el resto.'
        }
        cart.markProblems(problems)
      } else if (err?.status === 409 && err.details?.pending) {
        setOrderError(
          'Ya tienes pedidos esperando que el mesero los revise. Espera un momento y vuelve a intentarlo.',
        )
      } else if (err?.status === 409) {
        // TABLE_NOT_OPEN o INVALID_TRANSITION (en cobro): el estado cambio; se consulta de nuevo
        setOrderError(
          err.code === 'TABLE_NOT_OPEN'
            ? 'Tu mesa no tiene un mesero asignado; llama a un mesero para hacer tu pedido.'
            : 'Tu mesa ya está en proceso de pago; no se aceptan más pedidos.',
        )
        qr.retry()
      } else if (err?.status === 404) {
        setOrderOpen(false)
        qr.retry()
      } else if (err?.status === 429) {
        setOrderError('Hay muchas solicitudes en este momento. Espera unos segundos e intenta de nuevo.')
      } else {
        // Sin clave de idempotencia el pedido pudo llegar: no se reintenta solo y se avisa
        setOrderError(
          failedByNetwork
            ? 'Seguimos sin poder confirmar el envío. Llama al mesero para confirmar tu pedido.'
            : 'No pudimos confirmar el envío. Si lo intentas de nuevo y el pedido ya había llegado, el mesero podría recibirlo dos veces.',
        )
        setFailedByNetwork(true)
      }
    }
  }

  const callView = CALL_VIEW[waiterCall.state]

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
                  onOpen={(product) => setDetail({ product, categoryName: c.name })}
                />
              ))}
            </ul>
          </section>
        ))}
      </main>

      <div className="qr-dock">
        <p
          id="qr-call-feedback"
          className={`qr-shell qr-call-feedback${callView.message ? '' : ' sr-only'}${callView.tone ? ` qr-call-feedback--${callView.tone}` : ''}`}
          aria-live="polite"
        >
          {callView.message}
        </p>
        {caps && (caps.callWaiter || caps.requestBill) && (
          <div className="qr-shell qr-actions">
            {caps.callWaiter && (
              <button
                type="button"
                className={`qr-btn-call qr-btn-call--${waiterCall.state}`}
                onClick={waiterCall.call}
                disabled={callView.disabled}
                aria-describedby="qr-call-feedback"
              >
                <callView.icon
                  size={18}
                  className={waiterCall.state === 'sending' ? 'spin' : undefined}
                  aria-hidden="true"
                />
                {callView.label}
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
            {/* Mi Pedido (GC-QR-0003): disponible con la mesa ocupada o si ya hay algo en el carrito */}
            <button
              type="button"
              className="qr-tab"
              disabled={!caps?.sendRequest && cart.lines.length === 0}
              onClick={openOrder}
            >
              <span className="qr-tab__icon">
                <ShoppingCart size={22} aria-hidden="true" />
                {cart.units > 0 && (
                  <span className="qr-tab__badge" aria-hidden="true">
                    {cart.units}
                  </span>
                )}
              </span>
              Mi Pedido
              {cart.units > 0 && <span className="sr-only">({cart.units} productos)</span>}
            </button>
            {/* Estado (72:2) no tiene backend publico: queda deshabilitado */}
            <button type="button" className="qr-tab" disabled title="Próximamente">
              <ClipboardList size={22} aria-hidden="true" />
              Estado
              <span className="sr-only">(próximamente)</span>
            </button>
          </div>
        </nav>
      </div>

      {detail && (
        <QrProductSheet
          product={detail.product}
          categoryName={detail.categoryName}
          cartFull={cart.full}
          alreadyInCart={cart.lines.some((l) => l.productId === detail.product.productId)}
          onClose={() => setDetail(null)}
          onAdd={(quantity, note) => {
            cart.add(detail.product, quantity, note)
            setDetail(null)
          }}
        />
      )}

      {orderOpen && (
        <QrOrderSheet
          cart={cart}
          phase={orderPhase}
          sentLines={sentLines}
          error={orderError}
          blockedReason={blockedReason}
          onSend={handleSend}
          onClose={() => setOrderOpen(false)}
          onContinue={() => {
            setOrderOpen(false)
            setOrderPhase('editing')
          }}
        />
      )}
    </div>
  )
}

