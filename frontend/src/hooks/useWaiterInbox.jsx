/* eslint-disable react/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { getMenu } from '../api/menu.js'
import { listPendingQrRequests } from '../api/qrRequests.js'
import { listTableStatuses } from '../api/tablesStatus.js'
import { useAuth } from '../auth/useAuth.js'
import { useToast } from '../components/Toast.jsx'
import { useRealtimeEvents } from './useRealtimeEvent.js'

// GC-QR-0002/0003. Bandeja del mesero: llamados del cliente (call_waiter / request_bill) y solicitudes de
// pedido QR. Vive en el layout del mesero para que el badge de "Llamados" y la seccion compartan datos.
//   - Carga: GET /qr-requests (el backend ya filtra por mesero; ADMIN ve todas) y los pendingCalls de
//     GET /tables/status (el WAITER ve los de sus mesas y los de mesas libres, que van a todos; ADMIN todos).
//   - En vivo, con UNA conexion: waiter:called, qr_request:created, table:status_changed y order:updated.
//   - Al reconectar se recarga todo: lo emitido sin conexion se pierde.
const InboxContext = createContext(null)

const callsFrom = (statuses, user) =>
  statuses
    .filter((t) => user?.role === 'ADMIN' || t.status === 'libre' || t.waiterId === user?.userId)
    .flatMap((t) =>
      (t.pendingCalls ?? []).map((c) => ({
        serviceCallId: c.serviceCallId,
        tableId: t.tableId,
        tableNumber: t.tableNumber,
        tableStatus: t.status,
        orderId: t.orderId ?? null,
        type: c.type,
        createdAt: c.createdAt,
      })),
    )

const byOldest = (a, b) => new Date(a.createdAt) - new Date(b.createdAt)

export function WaiterInboxProvider({ children }) {
  const { user } = useAuth()
  const toast = useToast()
  const [requests, setRequests] = useState([])
  const [calls, setCalls] = useState([])
  const [products, setProducts] = useState(new Map())
  const [phase, setPhase] = useState('loading') // loading | ready | error
  const reloadTimer = useRef(null)
  const statuses = useRef(new Map())
  // IDs ya mostrados: un evento repetido (o que llega junto con una recarga) no se avisa dos veces
  const seen = useRef(new Set())

  const loadAll = useCallback(async () => {
    try {
      const [reqs, tables] = await Promise.all([listPendingQrRequests(), listTableStatuses()])
      statuses.current = new Map(tables.map((t) => [t.tableId, t]))
      for (const r of reqs) seen.current.add(r.qrRequestId)
      for (const c of callsFrom(tables, user)) seen.current.add(c.serviceCallId)
      setRequests([...reqs].sort(byOldest))
      setCalls(callsFrom(tables, user).sort(byOldest))
      setPhase('ready')
    } catch {
      setPhase((p) => (p === 'ready' ? p : 'error'))
    }
  }, [user])

  // Nombres de producto: la solicitud solo trae productId
  useEffect(() => {
    let active = true
    getMenu()
      .then((menu) => {
        if (active) setProducts(new Map(menu.flatMap((c) => c.products).map((p) => [p.productId, p])))
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    loadAll()
    return () => clearTimeout(reloadTimer.current)
  }, [loadAll])

  // Recarga agrupada (p. ej. tras una reasignacion la solicitud cambia de mesero sin evento propio)
  const reloadSoon = useCallback(() => {
    clearTimeout(reloadTimer.current)
    reloadTimer.current = setTimeout(loadAll, 400)
  }, [loadAll])

  useRealtimeEvents(
    {
      'waiter:called': (call) => {
        if (!call?.serviceCallId || seen.current.has(call.serviceCallId)) return
        seen.current.add(call.serviceCallId)
        setCalls((prev) =>
          prev.some((c) => c.serviceCallId === call.serviceCallId)
            ? prev
            : [
                ...prev,
                {
                  serviceCallId: call.serviceCallId,
                  tableId: call.tableId,
                  tableNumber: call.tableNumber,
                  tableStatus: statuses.current.get(call.tableId)?.status ?? 'libre',
                  orderId: statuses.current.get(call.tableId)?.orderId ?? null,
                  type: call.type,
                  createdAt: call.createdAt,
                },
              ].sort(byOldest),
        )
        toast.success(
          call.type === 'request_bill'
            ? `Mesa ${call.tableNumber} pide la cuenta`
            : `Mesa ${call.tableNumber} te llama`,
        )
      },
      'qr_request:created': (request) => {
        if (!request?.qrRequestId || seen.current.has(request.qrRequestId)) return
        seen.current.add(request.qrRequestId)
        setRequests((prev) =>
          prev.some((r) => r.qrRequestId === request.qrRequestId)
            ? prev
            : [...prev, request].sort(byOldest),
        )
        toast.success(`Mesa ${request.tableNumber} envió un pedido`)
      },
      'table:status_changed': (status) => {
        if (!status?.tableId) return
        const previous = statuses.current.get(status.tableId)
        statuses.current.set(status.tableId, status)
        // Los llamados de esa mesa son los que trae el evento (al abrir o pagar quedan atendidos)
        setCalls((prev) =>
          [
            ...prev.filter((c) => c.tableId !== status.tableId),
            ...callsFrom([status], user),
          ].sort(byOldest),
        )
        // Mesa libre: su orden se cerro y el pago rechazo sus solicitudes pendientes
        if (status.status === 'libre') {
          setRequests((prev) => prev.filter((r) => r.tableNumber !== status.tableNumber))
        }
        // Cambio de mesero (reasignacion): las solicitudes pendientes pasan al nuevo
        if (previous && previous.waiterId !== status.waiterId) reloadSoon()
      },
      'order:updated': (payload) => {
        if (payload?.status === 'CERRADA') {
          setRequests((prev) => prev.filter((r) => r.orderId !== payload.orderId))
        }
      },
    },
    { onReconnect: loadAll },
  )

  const removeRequest = useCallback(
    (qrRequestId) => setRequests((prev) => prev.filter((r) => r.qrRequestId !== qrRequestId)),
    [],
  )

  const value = useMemo(
    () => ({
      requests,
      calls,
      products,
      phase,
      count: requests.length + calls.length,
      reload: loadAll,
      removeRequest,
    }),
    [requests, calls, products, phase, loadAll, removeRequest],
  )

  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>
}

// Fuera del proveedor (p. ej. en tests de otras pantallas) devuelve una bandeja vacia
const EMPTY = {
  requests: [],
  calls: [],
  products: new Map(),
  phase: 'ready',
  count: 0,
  reload: () => {},
  removeRequest: () => {},
}

export function useWaiterInbox() {
  return useContext(InboxContext) ?? EMPTY
}
