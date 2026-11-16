import { prisma } from '../config/prisma.js';

// GC-RPT-0004. Agregados del dashboard en SQL: nada de traer filas a memoria. Todas las consultas son plantillas
// parametrizadas de $queryRaw ($queryRawUnsafe esta prohibido). `start`/`end` son instantes UTC [start, end).
//
// Ventas: el MISMO filtro que el cierre de caja (reports.repository.js): orden CERRADA con closed_at en el rango,
// y su pago (1:1, uq_payments_order). El dia y la hora salen de closed_at en hora de Colombia.
// Las sumas de dinero se piden como bigint (un periodo largo puede pasar de 2^31) y se convierten aqui.
const BOGOTA = 'America/Bogota'; // UTC-5 todo el ano, igual que BUSINESS_UTC_OFFSET

const toInt = (value) => Number(value ?? 0);

export async function salesTotals({ start, end }) {
  const [row] = await prisma.$queryRaw`
    SELECT count(*)::int AS orders, COALESCE(sum(p.total), 0)::bigint AS sales
    FROM orders o
    JOIN payments p ON p.order_id = o.order_id
    WHERE o.status = 'CERRADA' AND o.closed_at >= ${start} AND o.closed_at < ${end}`;
  return { orders: row.orders, sales: toInt(row.sales) };
}

export async function salesByDay({ start, end }) {
  const rows = await prisma.$queryRaw`
    SELECT to_char(o.closed_at AT TIME ZONE ${BOGOTA}, 'YYYY-MM-DD') AS date,
           count(*)::int AS orders, sum(p.total)::bigint AS total
    FROM orders o
    JOIN payments p ON p.order_id = o.order_id
    WHERE o.status = 'CERRADA' AND o.closed_at >= ${start} AND o.closed_at < ${end}
    GROUP BY 1`;
  return rows.map((r) => ({ date: r.date, orders: r.orders, totalSales: toInt(r.total) }));
}

export async function salesByHour({ start, end }) {
  const rows = await prisma.$queryRaw`
    SELECT EXTRACT(HOUR FROM o.closed_at AT TIME ZONE ${BOGOTA})::int AS hour,
           count(*)::int AS orders, sum(p.total)::bigint AS total
    FROM orders o
    JOIN payments p ON p.order_id = o.order_id
    WHERE o.status = 'CERRADA' AND o.closed_at >= ${start} AND o.closed_at < ${end}
    GROUP BY 1`;
  return rows.map((r) => ({ hour: r.hour, orders: r.orders, totalSales: toInt(r.total) }));
}

// Atribucion de ventas al mesero que ABRIO la mesa (opened_by), no al asignado actual ni al que cobro
export async function salesByWaiter({ start, end }) {
  const rows = await prisma.$queryRaw`
    SELECT o.opened_by AS "waiterId", count(*)::int AS orders, sum(p.total)::bigint AS total
    FROM orders o
    JOIN payments p ON p.order_id = o.order_id
    WHERE o.status = 'CERRADA' AND o.closed_at >= ${start} AND o.closed_at < ${end}
    GROUP BY o.opened_by`;
  return rows.map((r) => ({
    waiterId: r.waiterId,
    totalAmount: toInt(r.total),
    ordersCount: r.orders,
  }));
}

// Por el metodo guardado en el pago (payment_method_id no cambia aunque el metodo se renombre o desactive)
export async function salesByPaymentMethod({ start, end }) {
  const rows = await prisma.$queryRaw`
    SELECT p.payment_method_id AS "paymentMethodId", count(*)::int AS payments, sum(p.total)::bigint AS total
    FROM orders o
    JOIN payments p ON p.order_id = o.order_id
    WHERE o.status = 'CERRADA' AND o.closed_at >= ${start} AND o.closed_at < ${end}
    GROUP BY p.payment_method_id`;
  return rows.map((r) => ({
    paymentMethodId: r.paymentMethodId,
    totalAmount: toInt(r.total),
    paymentCount: r.payments,
  }));
}

// Productos vendidos (items no cancelados de esas ordenes), con el nombre del snapshot mas reciente (R3).
// El orden del top se decide en JS (dashboard.js) con el mismo desempate que el cierre de caja.
export async function soldProducts({ start, end }) {
  const rows = await prisma.$queryRaw`
    SELECT i.product_id AS "productId",
           (array_agg(i.product_name_snapshot ORDER BY i.created_at DESC))[1] AS "productName",
           sum(i.quantity)::int AS quantity,
           sum(i.quantity::bigint * i.unit_price_snapshot)::bigint AS revenue
    FROM items i
    JOIN rounds r ON r.round_id = i.round_id
    JOIN orders o ON o.order_id = r.order_id
    WHERE i.status <> 'cancelado'
      AND o.status = 'CERRADA' AND o.closed_at >= ${start} AND o.closed_at < ${end}
    GROUP BY i.product_id`;
  return rows.map((r) => ({
    productId: r.productId,
    productName: r.productName,
    quantitySold: r.quantity,
    revenue: toInt(r.revenue),
  }));
}

// Preparacion por producto: items no cancelados con ready_at en el rango (sin importar el estado de la orden:
// mide la cocina). Inicio = rounds.created_at, cuando la ronda llego a cocina (sent_at no existe). Un item con
// ready_at anterior a su ronda es incoherente: no se mide, se cuenta aparte en `discarded`.
export async function preparationByProduct({ start, end }) {
  const rows = await prisma.$queryRaw`
    SELECT i.product_id AS "productId",
           count(*) FILTER (WHERE i.ready_at >= r.created_at)::int AS items,
           COALESCE(sum(EXTRACT(EPOCH FROM i.ready_at - r.created_at))
                    FILTER (WHERE i.ready_at >= r.created_at), 0)::float8 AS seconds,
           count(*) FILTER (WHERE i.ready_at < r.created_at)::int AS discarded
    FROM items i
    JOIN rounds r ON r.round_id = i.round_id
    WHERE i.status <> 'cancelado' AND i.ready_at >= ${start} AND i.ready_at < ${end}
    GROUP BY i.product_id`;
  return rows.map((r) => ({
    productId: r.productId,
    items: r.items,
    seconds: Number(r.seconds),
    discarded: r.discarded,
  }));
}
