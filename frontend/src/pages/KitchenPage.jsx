import {
  Check,
  Clock,
  LoaderCircle,
  LogOut,
  Pizza,
  RefreshCw,
  Timer,
  TriangleAlert,
  WifiOff,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { fetchServerClockOffset, listKitchenRounds, updateItemStatus } from '../api/kitchen.js'
import { useAuth } from '../auth/useAuth.js'
import { useToast } from '../components/Toast.jsx'
import { useKitchenSocket } from '../hooks/useKitchenSocket.js'
import {
  addRound,
  applyItemChange,
  buildColumns,
  cardElapsedMs,
  countByStatus,
  formatClock,
  formatElapsed,
  isItemDelayed,
  KITCHEN_STATUSES,
} from '../utils/kitchen.js'
import './KitchenPage.css'

const COLUMN = {
  pendiente: { title: 'Pendiente', short: 'Pend', count: 'Pendientes', countShort: 'Pend' },
  en_preparacion: {
    title: 'En Preparación',
    short: 'Prep',
    count: 'En Prep.',
    countShort: 'Prep',
  },
  listo: { title: 'Listo', short: 'Listo', count: 'Listos', countShort: 'Listo' },
}

const ACTION = {
  pendiente: { label: 'Iniciar', next: 'en_preparacion', modifier: 'start' },
  en_preparacion: { label: 'Listo', next: 'listo', modifier: 'ready' },
}

function useNow(offset) {
  const [now, setNow] = useState(() => Date.now() + offset)
  useEffect(() => {
    const tick = () => setNow(Date.now() + offset)
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [offset])
  return now
}

function KitchenItem({ item, now, busy, onAdvance }) {
  const action = ACTION[item.status]
  const delayed = isItemDelayed(item, now)
  const name = `${item.quantity}× ${item.productName}`

  return (
    <li className={`kds-item${delayed ? ' kds-item--delayed' : ''}`}>
      <div className="kds-item__text">
        <span className="kds-item__name">{name}</span>
        {item.note && (
          <span className="kds-item__note">
            <TriangleAlert size={12} aria-hidden="true" /> {item.note}
          </span>
        )}
        {delayed && <span className="kds-item__delay">Más de 15 min</span>}
      </div>
      {action ? (
        <button
          type="button"
          className={`kds-action kds-action--${action.modifier}`}
          onClick={() => onAdvance(item, action.next)}
          disabled={busy}
          aria-label={`${action.label}: ${name}`}
        >
          {busy ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : action.label}
        </button>
      ) : (
        <Check className="kds-item__done" size={16} strokeWidth={3} aria-label="Listo" />
      )}
    </li>
  )
}

function KitchenCard({ card, now, busyItems, onAdvance }) {
  return (
    <article className={`kds-card kds-card--${card.status}`}>
      <header className="kds-card__header">
        <div className="kds-card__title">
          <h3 className="kds-card__table">Mesa {card.tableNumber}</h3>
          {card.status === 'en_preparacion' && (
            <span className="kds-card__dot" aria-hidden="true" />
          )}
          {card.status === 'listo' && (
            <span className="kds-card__pill">
              <Check size={12} strokeWidth={3} aria-hidden="true" /> Listo
            </span>
          )}
        </div>
        <span className="kds-card__time">
          <Timer size={13} aria-hidden="true" />
          <span className="sr-only">Tiempo </span>
          {formatElapsed(cardElapsedMs(card, now))}
        </span>
      </header>
      <ul className="kds-card__items">
        {card.items.map((item) => (
          <KitchenItem
            key={item.itemId}
            item={item}
            now={now}
            busy={busyItems.has(item.itemId)}
            onAdvance={onAdvance}
          />
        ))}
      </ul>
    </article>
  )
}

export default function KitchenPage() {
  const toast = useToast()
  const navigate = useNavigate()
  const { logout } = useAuth()
  const [{ status, rounds }, setData] = useState({ status: 'loading', rounds: [] })
  const [filter, setFilter] = useState('todos')
  const [busyItems, setBusyItems] = useState(() => new Set())
  const [clockOffset, setClockOffset] = useState(0)
  const now = useNow(clockOffset)

  const fetchRounds = useCallback(async () => {
    try {
      return { status: 'ready', rounds: await listKitchenRounds() }
    } catch {
      return null
    }
  }, [])

  // Una recarga que falla conserva lo que se ve: la cocina sigue trabajando con eso.
  const refresh = useCallback(() => {
    return fetchRounds().then((result) => {
      setData(
        (current) =>
          result ?? (current.status === 'ready' ? current : { status: 'error', rounds: [] }),
      )
    })
  }, [fetchRounds])

  useEffect(() => {
    let active = true
    fetchRounds().then((result) => {
      if (active) setData(result ?? { status: 'error', rounds: [] })
    })
    fetchServerClockOffset().then((offset) => {
      if (active) setClockOffset(offset)
    })
    return () => {
      active = false
    }
  }, [fetchRounds])

  const { connected } = useKitchenSocket({
    onRoundCreated: (round) =>
      setData((current) => ({ ...current, rounds: addRound(current.rounds, round) })),
    onItemChanged: (item) =>
      setData((current) => ({ ...current, rounds: applyItemChange(current.rounds, item) })),
    onReconnected: refresh,
  })

  const retry = () => {
    setData({ status: 'loading', rounds: [] })
    refresh()
  }

  const handleAdvance = async (item, nextStatus) => {
    setBusyItems((current) => new Set(current).add(item.itemId))
    try {
      const updated = await updateItemStatus(item.itemId, nextStatus)
      setData((current) => ({ ...current, rounds: applyItemChange(current.rounds, updated) }))
    } catch (err) {
      toast.error(err?.message || 'No se pudo actualizar el ítem')
      // Otro cocinero lo movio o el ADMIN lo anulo: lo que se ve quedo viejo
      if (err?.status === 409 || err?.status === 404) refresh()
    } finally {
      setBusyItems((current) => {
        const next = new Set(current)
        next.delete(item.itemId)
        return next
      })
    }
  }

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  const columns = useMemo(() => buildColumns(rounds), [rounds])
  const counts = useMemo(() => countByStatus(rounds), [rounds])
  const visibleCards = filter === 'todos' ? rounds.length : columns[filter].length

  return (
    <div className="kds">
      <header className="kds-bar">
        <div className="kds-bar__brand">
          <Pizza className="kds-bar__logo" size={22} aria-hidden="true" />
          <span className="kds-bar__name">GastroCore</span>
          <span className="kds-bar__role">COCINA</span>
        </div>
        <h1 className="kds-bar__title">
          <span className="kds-bar__title-full">Kitchen Display System</span>
          <span className="kds-bar__title-short">KDS</span>
        </h1>
        <div className="kds-bar__end">
          <dl className="kds-counters">
            {KITCHEN_STATUSES.map((key) => (
              <div key={key} className={`kds-counter kds-counter--${key}`}>
                <dt className="kds-counter__label">
                  <span className="kds-counter__label-full">{COLUMN[key].count}</span>
                  <span className="kds-counter__label-short">{COLUMN[key].countShort}</span>
                </dt>
                <dd className="kds-counter__value">{counts[key]}</dd>
              </div>
            ))}
          </dl>
          <time className="kds-bar__clock">{formatClock(now)}</time>
          <Link className="kds-bar__icon" to="/mi-turno" aria-label="Mi Turno" title="Mi Turno">
            <Clock size={18} aria-hidden="true" />
          </Link>
          <button
            type="button"
            className="kds-bar__icon"
            onClick={handleLogout}
            aria-label="Cerrar sesión"
            title="Cerrar sesión"
          >
            <LogOut size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      {!connected && (
        <p className="kds-offline" role="status">
          <WifiOff size={16} aria-hidden="true" /> Sin conexión en tiempo real. Reintentando; los
          pedidos nuevos pueden tardar en aparecer.
        </p>
      )}

      <div className="kds-filters" role="group" aria-label="Filtrar por estado">
        {['todos', ...KITCHEN_STATUSES].map((key) => (
          <button
            key={key}
            type="button"
            className={`kds-filter${filter === key ? ' kds-filter--active' : ''}`}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {key === 'todos' ? (
              'Todos'
            ) : (
              <>
                <span className="kds-filter__full">{COLUMN[key].title}</span>
                <span className="kds-filter__short" aria-hidden="true">
                  {COLUMN[key].short}
                </span>
              </>
            )}
          </button>
        ))}
      </div>

      {status === 'error' ? (
        <div className="kds-state" role="alert">
          <TriangleAlert size={28} aria-hidden="true" />
          <p>No se pudieron cargar los pedidos de cocina.</p>
          <button type="button" className="btn btn--ghost" onClick={retry}>
            <RefreshCw size={16} aria-hidden="true" /> Reintentar
          </button>
        </div>
      ) : status === 'loading' ? (
        <div className="kds-state" role="status" aria-label="Cargando pedidos">
          <LoaderCircle className="spin" size={28} aria-hidden="true" />
        </div>
      ) : (
        <main className="kds-board">
          {KITCHEN_STATUSES.map((key) => (
            <section
              key={key}
              className={`kds-column kds-column--${key}${
                filter !== 'todos' && filter !== key ? ' kds-column--filtered' : ''
              }`}
              aria-label={COLUMN[key].title}
            >
              <h2 className="kds-column__header">
                <span className="kds-column__dot" aria-hidden="true" />
                {COLUMN[key].title}
              </h2>
              {columns[key].map((card) => (
                <KitchenCard
                  key={card.key}
                  card={card}
                  now={now}
                  busyItems={busyItems}
                  onAdvance={handleAdvance}
                />
              ))}
              {columns[key].length === 0 && <p className="kds-column__empty">Sin pedidos</p>}
            </section>
          ))}
          {visibleCards === 0 && <p className="kds-empty">Sin pedidos</p>}
        </main>
      )}
    </div>
  )
}
